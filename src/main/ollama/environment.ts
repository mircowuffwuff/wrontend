// the user's stored environment variables -- not wrontend's own process environment, which is a copy from when it started.
// on Windows they are HKCU\Environment, written through .NET so the change is broadcast and Explorer's next launches see it

import { execFile } from 'node:child_process';

export type Stored = Record<string, string>;

export interface UserEnvironment {
  // every stored variable whose name starts with the prefix, the user's and the machine-wide ones apart
  read(prefix: string): Promise<{ user: Stored; machine: Stored }>;
  // null removes the user's variable
  write(changes: Record<string, string | null>): Promise<void>;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const windowsEnvironment: UserEnvironment = {
  async read(prefix) {
    if (!NAME.test(prefix)) throw new Error(`not a variable prefix: ${prefix}`);
    const json = await powershell(
      `$out = @{}
      foreach ($scope in 'User', 'Machine') {
        $all = [Environment]::GetEnvironmentVariables($scope)
        $picked = @{}
        foreach ($key in $all.Keys) { if ($key -like '${prefix}*') { $picked[$key] = [string]$all[$key] } }
        $out[$scope] = $picked
      }
      $out | ConvertTo-Json -Compress`,
    );
    const parsed = JSON.parse(json) as { User?: Stored; Machine?: Stored };
    return { user: parsed.User ?? {}, machine: parsed.Machine ?? {} };
  },

  async write(changes) {
    for (const name of Object.keys(changes)) if (!NAME.test(name)) throw new Error(`not a variable name: ${name}`);
    // the values travel in an environment variable of the child, never inside the script's text
    await powershell(
      `$changes = $env:WRONTEND_ENV_CHANGES | ConvertFrom-Json
      foreach ($change in $changes.PSObject.Properties) { [Environment]::SetEnvironmentVariable($change.Name, $change.Value, 'User') }`,
      { WRONTEND_ENV_CHANGES: JSON.stringify(changes) },
    );
  },
};

// for the smoke test and the unit tests: stored nowhere, gone with the process
export function memoryEnvironment(initial: { user?: Stored; machine?: Stored } = {}): UserEnvironment & { user: Stored } {
  const user: Stored = { ...initial.user };
  const machine: Stored = { ...initial.machine };
  const pick = (from: Stored, prefix: string) => Object.fromEntries(Object.entries(from).filter(([k]) => k.startsWith(prefix)));
  return {
    user,
    read: async (prefix) => ({ user: pick(user, prefix), machine: pick(machine, prefix) }),
    write: async (changes) => {
      for (const [name, value] of Object.entries(changes)) {
        if (value === null || value === '') delete user[name];
        else user[name] = value;
      }
    },
  };
}

// a script passed encoded, so no quoting of Node's or the shell's can bend it; its output is read as UTF-8
export function powershell(script: string, env: Record<string, string> = {}): Promise<string> {
  const full = `$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [Text.Encoding]::UTF8\n${script}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, ...env }, windowsHide: true, encoding: 'utf8', timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve(stdout.trim());
      },
    );
  });
}
