// typed helpers over ipcMain, so a handler cannot drift from the contract in @shared/ipc

import { ipcMain, type BrowserWindow } from 'electron';
import type { EventChannel, EventMap, InvokeChannel, InvokeMap } from '@shared/ipc';

export function handle<K extends InvokeChannel>(
  channel: K,
  handler: (...args: InvokeMap[K]['args']) => InvokeMap[K]['result'] | Promise<InvokeMap[K]['result']>,
): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as InvokeMap[K]['args'])));
}

export function send<K extends EventChannel>(win: BrowserWindow | null, channel: K, payload: EventMap[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
