// npm, which installs every component published on npm. the system's npm when Node 22 or newer is found with npm beside it --
// it brings the user's own .npmrc, with any proxy or registry mirror in it. without one, wrontend downloads npm as a component
// of its own and runs it on Electron's Node. unpacking a tarball itself instead of running npm would replace what every app
// that installs npm-based agents relies on with a mechanism of wrontend's own

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ComponentStore } from './store';
import { compareVersions } from './version';

export const NPM_COMPONENT = 'npm';
const MINIMUM_NODE = '22.0.0';
export const REGISTRY = 'https://registry.npmjs.org';

export interface Npm {
  source: 'system' | 'wrontend';
  version: string;
  // the program and its leading arguments; npm's own arguments follow them
  command: string;
  args: string[];
  env: Record<string, string>;
}

// a failure with the text a user can read and the output behind it
export class InstallError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

// npm is found as npm-cli.js beside node and started with that node: current Node starts npm.cmd only through a shell
export async function findSystemNpm(path = process.env.PATH ?? '', platform = process.platform): Promise<Npm | null> {
  const exe = platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of path.split(platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    const node = join(dir, exe);
    if (!existsSync(node)) continue;
    const cli = platform === 'win32' ? join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js') : join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    // the first node on PATH is the one the user runs; a shim without npm beside it does not count, and nothing further on does
    if (!existsSync(cli)) return null;
    const version = await nodeVersion(node);
    if (!version || compareVersions(version, MINIMUM_NODE) < 0) return null;
    return { source: 'system', version: packageVersion(join(dirname(cli), '..')), command: node, args: [cli], env: {} };
  }
  return null;
}

// npm installed by wrontend into its components, if there is one
export function wrontendNpm(store: ComponentStore): Npm | null {
  const active = store.active(NPM_COMPONENT);
  if (!active) return null;
  const cli = join(active.dir, 'bin', 'npm-cli.js');
  if (!existsSync(cli)) return null;
  return { source: 'wrontend', version: active.version, ...onOwnNode(cli) };
}

// a Node script run by the runtime wrontend itself runs on
export function onOwnNode(script: string): { command: string; args: string[]; env: Record<string, string> } {
  return { command: process.execPath, args: [script], env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
}

// downloads npm's latest release from the registry, checks it against its published sha512 and unpacks it with the
// operating system's own tar
export async function bootstrapNpm(store: ComponentStore, registry = REGISTRY): Promise<Npm> {
  const latest = (await getJson(`${registry}/npm/latest`)) as { version: string; dist: { tarball: string; integrity: string } };
  const version = latest.version;
  const response = await get(latest.dist.tarball);
  const tarball = Buffer.from(await response.arrayBuffer());
  const [algorithm, expected] = latest.dist.integrity.split('-', 2);
  const actual = createHash(algorithm).update(tarball).digest('base64');
  if (actual !== expected) throw new InstallError('The downloaded npm did not match its published checksum.', `${algorithm} ${actual}, expected ${expected}`);

  const dir = store.begin(NPM_COMPONENT, version);
  const file = `${dir}.tgz`;
  try {
    writeFileSync(file, tarball);
    await run(systemTar(), ['-xzf', file, '-C', dir, '--strip-components=1'], {}, dirname(dir));
    store.finish(NPM_COMPONENT, version);
  } catch (cause) {
    store.abandon(NPM_COMPONENT, version);
    throw cause instanceof InstallError ? cause : new InstallError('npm could not be unpacked.', String(cause));
  } finally {
    rmSync(file, { force: true });
  }
  const npm = wrontendNpm(store);
  if (!npm) throw new InstallError('npm was unpacked but its program is missing.', join(store.dir(NPM_COMPONENT, version), 'bin', 'npm-cli.js'));
  return npm;
}

// runs npm and returns what it printed to stdout
export function runNpm(npm: Npm, args: string[], cwd: string): Promise<string> {
  return run(npm.command, [...npm.args, ...args], npm.env, cwd);
}

function run(command: string, args: string[], env: Record<string, string>, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...childEnvironment(), ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err = (err + chunk.toString()).slice(-20_000)));
    child.on('error', (cause) => reject(new InstallError(`${command} could not be started.`, String(cause))));
    child.on('close', (code) => {
      if (code === 0) return resolve(out);
      const reason = err.split('\n').find((l) => /^npm (error|ERR!) /.test(l) && !/^npm (error|ERR!) (code|A complete log)/.test(l));
      reject(new InstallError(reason ? reason.replace(/^npm (error|ERR!) /, '') : `${command} ended with exit code ${code}.`, `${command} ${args.join(' ')}\n\n${err || out}`));
    });
  });
}

// wrontend's own environment without what npm put there when it started wrontend (npm run dev): an npm_config_ variable
// changes what the child npm does
function childEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^npm_/i.test(key) || key === 'ELECTRON_RUN_AS_NODE') continue;
    env[key] = value;
  }
  return env;
}

// the tar that comes with the operating system -- on Windows, a tar earlier on PATH (Git's) reads C: as a remote host
function systemTar(): string {
  if (process.platform === 'win32') return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return '/usr/bin/tar';
}

function nodeVersion(node: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(node, ['--version'], { timeout: 10_000, windowsHide: true, env: childEnvironment() }, (error, stdout) => {
      resolve(error ? null : stdout.trim().replace(/^v/, ''));
    });
  });
}

function packageVersion(dir: string): string {
  try {
    return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

async function getJson(url: string): Promise<unknown> {
  return (await get(url)).json();
}

async function get(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new InstallError('The npm registry could not be reached.', `${url}\n\n${String((cause as Error).cause ?? cause)}`);
  }
  if (!response.ok) throw new InstallError('The npm registry refused the request.', `${response.status} ${response.statusText} from ${url}`);
  return response;
}
