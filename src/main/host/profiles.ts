// a harness profile is plain data: what to start, with which environment, pointed at which proxy route

import { join } from 'node:path';
import { BACKGROUND_MODEL, MAIN_MODEL } from '@shared/proxy';
import { onOwnNode } from '../components/npm';

export interface LaunchContext {
  // the session's own proxy base URL
  proxyUrl: string;
  // a folder of wrontend's own where the harness keeps its config and history
  harnessHome: string;
  // the program of the harness's installed component, as the component resolver finds it; null for a built-in harness
  program: string | null;
}

export interface HarnessProfile {
  id: string;
  name: string;
  // the component that brings its program, installed on the harness's first pick; null for one built into wrontend
  component: string | null;
  launch(ctx: LaunchContext): { command: string; args: string[]; env: Record<string, string> };
}

export const claudeCode: HarnessProfile = {
  id: 'claude-code',
  name: 'Claude Code',
  component: 'claude-code',
  launch({ proxyUrl, harnessHome, program }) {
    if (!program) throw new Error('Claude Code is not set up. Picking it for a new session sets it up.');
    // the adapter runs on Electron's own Node, whichever npm installed it, so the runtime is the same on every machine
    const base = onOwnNode(program);
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
  component: null,
  launch() {
    return onOwnNode(join(__dirname, 'fake-agent.js'));
  },
};

export const PROFILES: Record<string, HarnessProfile> = { [claudeCode.id]: claudeCode, [fake.id]: fake };
