import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { portableDataFolder } from './portable';

vi.mock('electron', () => ({ app: {} }));

const folder = join('D:', 'tools', 'wrontend');
const exe = join(folder, 'wrontend.exe');

describe('the portable data folder', () => {
  it('is the data folder beside the exe when portable.txt is there', () => {
    expect(portableDataFolder(exe, (path) => path === join(folder, 'portable.txt'))).toBe(join(folder, 'data'));
  });

  it('is the data folder beside the exe when a bare portable file is there', () => {
    expect(portableDataFolder(exe, (path) => path === join(folder, 'portable'))).toBe(join(folder, 'data'));
  });

  it('is not asked for without a marker', () => {
    expect(portableDataFolder(exe, () => false)).toBeNull();
  });

  it('looks only beside the exe', () => {
    expect(portableDataFolder(exe, (path) => path === join('D:', 'tools', 'portable.txt'))).toBeNull();
  });
});
