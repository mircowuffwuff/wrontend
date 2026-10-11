// a harness profile is plain data: what to start, with which environment, pointed at which proxy route

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { BACKGROUND_MODEL, MAIN_MODEL } from '@shared/proxy';

export interface LaunchContext {
  // the session's own proxy base URL
  proxyUrl: string;
  // a folder of wrontend's own where the harness keeps its config and history
  harnessHome: string;
}

export interface HarnessProfile {
  id: string;
  name: string;
  launch(ctx: LaunchContext): { command: string; args: string[]; env: Record<string, string> };
}

const require = createRequire(__filename);

// a Node script inside wrontend's own dependencies, run by the runtime wrontend itself runs on
function nodeScript(script: string): { command: string; args: string[]; env: Record<string, string> } {
  return { command: process.execPath, args: [script], env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
}

export const claudeCode: HarnessProfile = {
  id: 'claude-code',
  name: 'Claude Code',
  launch({ proxyUrl, harnessHome }) {
    const pkg = require.resolve('@agentclientprotocol/claude-agent-acp/package.json');
    const base = nodeScript(join(dirname(pkg), 'dist', 'index.js'));
    return {
      ...base,
      env: {
        ...base.env,
        ANTHROPIC_BASE_URL: proxyUrl,
        ANTHROPIC_AUTH_TOKEN: 'ollama',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_MODEL: MAIN_MODEL,
        ANTHROPIC_DEFAULT_OPUS_MODEL: MAIN_MODEL,
        ANTHROPIC_DEFAULT_SONNET_MODEL: MAIN_MODEL,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: BACKGROUND_MODEL,
        // request fields a non-Anthropic backend may reject, and traffic to Anthropic a local setup has no use for
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        // its own config folder: the user's normal Claude Code settings, login and history stay untouched
        CLAUDE_CONFIG_DIR: harnessHome,
      },
    };
  },
};

// the scripted agent from fake-agent.ts, for testing the app without a model
export const fake: HarnessProfile = {
  id: 'fake',
  name: 'Fake Agent',
  launch() {
    return nodeScript(join(__dirname, 'fake-agent.js'));
  },
};

export const PROFILES: Record<string, HarnessProfile> = { [claudeCode.id]: claudeCode, [fake.id]: fake };
