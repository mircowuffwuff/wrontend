import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempFolder as temp } from '../temp-folder';
import { bootstrapNpm, findSystemNpm, InstallError, runNpm } from './npm';
import { ComponentStore } from './store';

// a tarball laid out as npm publishes one: everything under package/
function npmTarball(version: string): Buffer {
  const dir = temp('wrontend-npm-src-');
  mkdirSync(join(dir, 'package', 'bin'), { recursive: true });
  writeFileSync(join(dir, 'package', 'package.json'), JSON.stringify({ name: 'npm', version }));
  writeFileSync(join(dir, 'package', 'bin', 'npm-cli.js'), "console.log(JSON.stringify(process.argv.slice(2)))");
  const file = join(dir, 'npm.tgz');
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar';
  execFileSync(tar, ['-czf', file, '-C', dir, 'package']);
  return readFileSync(file);
}

// a registry with npm's latest release on it, whose published checksum can be made wrong
function registry(tarball: Buffer, integrity: string): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (req.url === '/npm/latest') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ version: '12.2.0', dist: { tarball: `${base}/npm/-/npm-12.2.0.tgz`, integrity } }));
    }
    if (req.url === '/npm/-/npm-12.2.0.tgz') return res.end(tarball);
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server })));
}

let open: Server | null = null;
afterEach(() => {
  open?.close();
  open = null;
});

describe('finding the system npm', () => {
  it('finds none on an empty PATH or one without node', async () => {
    expect(await findSystemNpm('')).toBeNull();
    expect(await findSystemNpm(temp('wrontend-path-'))).toBeNull();
  });

  // the Node running the tests, when it was installed with npm beside it
  const nodeDir = dirname(process.execPath);
  const bundled = process.platform === 'win32' ? join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js') : join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  it.skipIf(!existsSync(bundled))('finds npm-cli.js beside the first node on PATH and runs it with that node', async () => {
    const npm = await findSystemNpm(`${temp('wrontend-path-')}${process.platform === 'win32' ? ';' : ':'}${nodeDir}`);
    expect(npm).toMatchObject({ source: 'system', command: process.execPath, args: [bundled] });
    expect((await runNpm(npm!, ['--version'], tmpdir())).trim()).toBe(npm!.version);
  });
});

describe('downloading npm', () => {
  it('unpacks npm into its own versioned folder after checking its checksum', async () => {
    const tarball = npmTarball('12.2.0');
    const { url, server } = await registry(tarball, `sha512-${createHash('sha512').update(tarball).digest('base64')}`);
    open = server;
    const store = new ComponentStore(temp('wrontend-components-'));

    const npm = await bootstrapNpm(store, url);

    expect(npm).toMatchObject({ source: 'wrontend', version: '12.2.0', args: [join(store.root, 'npm', '12.2.0', 'bin', 'npm-cli.js')] });
    expect(store.active('npm')?.version).toBe('12.2.0');
    expect(JSON.parse(await runNpm(npm, ['view', 'x'], tmpdir()))).toEqual(['view', 'x']);
  });

  it('refuses a download that does not match its checksum and keeps nothing of it', async () => {
    const tarball = npmTarball('12.2.0');
    const { url, server } = await registry(tarball, `sha512-${createHash('sha512').update('something else').digest('base64')}`);
    open = server;
    const store = new ComponentStore(temp('wrontend-components-'));

    await expect(bootstrapNpm(store, url)).rejects.toBeInstanceOf(InstallError);
    expect(store.active('npm')).toBeNull();
    expect(readdirSync(store.root)).toEqual([]);
  });

  it('says the registry could not be reached', async () => {
    const store = new ComponentStore(temp('wrontend-components-'));
    await expect(bootstrapNpm(store, 'http://127.0.0.1:1')).rejects.toThrow('The npm registry could not be reached.');
  });
});
