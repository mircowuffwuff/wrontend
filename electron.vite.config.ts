import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const alias = { '@shared': resolve(__dirname, 'src/shared') };

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        // the scripted test agent is its own program, started as a child process like any harness
        input: { index: resolve(__dirname, 'src/main/index.ts'), 'fake-agent': resolve(__dirname, 'src/main/host/fake-agent.ts') },
      },
    },
  },
  preload: { resolve: { alias } },
  renderer: {
    resolve: { alias: { ...alias, '@renderer': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react()],
  },
});
