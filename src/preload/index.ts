// the only door between the renderer and the main process: typed invoke and event channels, nothing else

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { EventChannel, EventMap, WrontendBridge } from '@shared/ipc';

const bridge: WrontendBridge = {
  // Electron wraps what a handler threw in a sentence of its own; the caller gets the handler's message
  invoke: (channel, ...args) =>
    ipcRenderer.invoke(channel, ...args).catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }),
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void) {
    const wrapped = (_event: IpcRendererEvent, payload: EventMap[K]) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('wrontend', bridge);
