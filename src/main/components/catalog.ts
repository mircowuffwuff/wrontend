// every component wrontend knows how to install

import type { CatalogEntry } from './engine';

export const CATALOG: CatalogEntry[] = [
  // Claude Code's ACP adapter; the Agent SDK it depends on brings the Claude Code program for the platform
  { id: 'claude-code', name: 'Claude Code', npm: '@agentclientprotocol/claude-agent-acp', bin: 'claude-agent-acp', floor: '0.89.1' },
];
