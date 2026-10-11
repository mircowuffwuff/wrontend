// the preload's bridge, typed

import type { WrontendBridge } from '@shared/ipc';

declare global {
  interface Window {
    wrontend: WrontendBridge;
  }
}

export const bridge = window.wrontend;
