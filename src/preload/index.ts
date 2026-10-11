// the only door between the renderer and main: typed invoke and event channels, nothing else

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { EventChannel, EventMap, WrontendBridge } from '@shared/ipc';

const bridge: WrontendBridge = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void) {
    const wrapped = (_event: IpcRendererEvent, payload: EventMap[K]) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('wrontend', bridge);
