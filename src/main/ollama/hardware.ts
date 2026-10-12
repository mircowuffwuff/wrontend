// what the model browser's fit labels are measured against: the GPU memory Ollama can use, the RAM, and the context length
// Ollama loads models with. Ollama's API says none of it; its server log does, in the lines it writes as it starts

import { execFile } from 'node:child_process';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import type { Hardware } from '@shared/models';

// the log is read from its end: the lines of the latest start are there, and the file grows for as long as Ollama runs
const TAIL = 1 << 20;

export function ollamaLogFile(): string | null {
  return process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Ollama', 'server.log') : null;
}

function tail(file: string): string | null {
  try {
    const size = statSync(file).size;
    const fd = openSync(file, 'r');
    try {
      const length = Math.min(size, TAIL);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      return buffer.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

const UNITS: Record<string, number> = { B: 1, KiB: 2 ** 10, MiB: 2 ** 20, GiB: 2 ** 30, TiB: 2 ** 40 };

function bytes(value: string): number | null {
  const match = /^([\d.]+) (B|KiB|MiB|GiB|TiB)$/.exec(value);
  return match ? Number(match[1]) * UNITS[match[2]] : null;
}

// the GPU memory available to Ollama at its latest start, summed over its devices, and the context it defaults to
export function parseOllamaLog(text: string): { gpuBytes: number | null; defaultContext: number | null } {
  const lines = text.split('\n');
  const compute = lines.filter((l) => l.includes('msg="inference compute"'));
  let gpuBytes: number | null = null;
  if (compute.length > 0) {
    // the devices of one start are logged in the same instant
    const stamp = /^time=(\S+)/.exec(compute.at(-1)!)?.[1];
    const latest = compute.filter((l) => /^time=(\S+)/.exec(l)?.[1] === stamp);
    const sizes = latest.map((l) => bytes(/ available="([^"]+)"/.exec(l)?.[1] ?? '')).filter((n): n is number => n !== null);
    if (sizes.length > 0) gpuBytes = sizes.reduce((a, b) => a + b, 0);
  }
  const context = lines.filter((l) => l.includes('default_num_ctx=')).at(-1);
  const defaultContext = context ? Number(/default_num_ctx=(\d+)/.exec(context)?.[1]) || null : null;
  return { gpuBytes, defaultContext };
}

// the largest display adapter's memory, from its driver's registry entry -- a 64-bit value, where WMI's AdapterRAM stops at 4 GB
export function registryGpuBytes(): Promise<number | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const key = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/s', '/v', 'HardwareInformation.qwMemorySize'], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) return resolve(null);
      const sizes = [...stdout.matchAll(/REG_QWORD\s+0x([0-9a-f]+)/gi)].map((m) => parseInt(m[1], 16));
      resolve(sizes.length > 0 ? Math.max(...sizes) : null);
    });
  });
}

export interface HardwareOptions {
  // only an Ollama on this machine is measured here; one elsewhere runs on hardware wrontend cannot see
  local: boolean;
  // OLLAMA_CONTEXT_LENGTH as stored, if it is
  contextSetting: string | null;
  logFile?: string | null;
}

export async function readHardware(options: HardwareOptions): Promise<Hardware | null> {
  if (!options.local) return null;
  const logFile = options.logFile === undefined ? ollamaLogFile() : options.logFile;
  const text = logFile ? tail(logFile) : null;
  const log = text ? parseOllamaLog(text) : { gpuBytes: null, defaultContext: null };
  const stored = Number(options.contextSetting);
  const contextLength = Number.isInteger(stored) && stored > 0 ? stored : (log.defaultContext ?? 4096);
  if (log.gpuBytes !== null) return { gpuBytes: log.gpuBytes, ramBytes: totalmem(), contextLength, source: 'ollama' };
  const registry = await registryGpuBytes();
  return registry === null ? null : { gpuBytes: registry, ramBytes: totalmem(), contextLength, source: 'registry' };
}

export function isLocalAddress(baseUrl: string): boolean {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}
