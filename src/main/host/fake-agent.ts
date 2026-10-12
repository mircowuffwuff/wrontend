// a scripted ACP agent for testing the app without a model: thinking, a plan, markdown, a read, an edit that needs permission.
// a prompt containing "slow" streams thinking until it is cancelled, one containing "fail" ends the turn with an error,
// one containing "echo" answers with how many quoted lines it carried, and one containing "several" edits several files

import { Readable, Writable } from 'node:stream';
import { agent, ndJsonStream, PROTOCOL_VERSION, RequestError, type AgentContext, type SessionUpdate } from '@agentclientprotocol/sdk';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cancelled = new Set<string>();

const OLD = '# readme\n\nwrontend is a frontend.\n\n## usage\n\nrun it.\n';
const NEW = '# readme\n\nwrontend is a graphical frontend for terminal coding agents.\n\n## usage\n\nrun it.\n';

// the edits of a prompt containing "several": five files, one of them edited twice, and one edit that fails
const SEVERAL: { diff: { path: string; oldText: string | null; newText: string }; fails?: boolean }[] = [
  { diff: { path: 'src/app.ts', oldText: 'const port = 3000;\nlisten(port);\n', newText: 'const port = Number(process.env.PORT ?? 3000);\nlisten(port);\n' } },
  { diff: { path: 'src/view.ts', oldText: 'export const title = "app";\n', newText: 'export const title = "wrontend";\nexport const subtitle = "a frontend";\n' } },
  { diff: { path: 'package-lock.json', oldText: '{}\n', newText: '{ "lockfileVersion": 3 }\n' }, fails: true },
  { diff: { path: 'docs/usage.md', oldText: null, newText: '# usage\n\nrun it with npm start.\n' } },
  { diff: { path: 'src/app.ts', oldText: 'listen(port);\n', newText: 'listen(port, () => log(`listening on ${port}`));\n' } },
  { diff: { path: 'readme.md', oldText: 'run it.\n', newText: 'run it with npm start.\n' } },
  { diff: { path: 'package.json', oldText: '"start": "node app.js"\n', newText: '"start": "node dist/app.js"\n' } },
];

const ANSWER = `Done — the readme now says what wrontend is.

- the first paragraph names it a **graphical frontend**
- the usage section is untouched

\`\`\`ts
const answer = 42;
\`\`\``;

async function update(client: AgentContext, sessionId: string, update: SessionUpdate): Promise<void> {
  await client.notify('session/update', { sessionId, update });
}

async function stream(client: AgentContext, sessionId: string, kind: 'agent_thought_chunk' | 'agent_message_chunk', text: string) {
  for (const word of text.split(/(?<= )/)) {
    await update(client, sessionId, { sessionUpdate: kind, content: { type: 'text', text: word } });
    await sleep(15);
  }
}

const app = agent({ name: 'wrontend-fake-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    agentInfo: { name: 'wrontend-fake-agent', version: '0.1.0' },
  }))
  .onRequest('session/new', () => ({
    sessionId: `fake-${Date.now()}`,
    modes: {
      currentModeId: 'default',
      availableModes: [
        { id: 'default', name: 'Default', description: 'Asks before edits and commands' },
        { id: 'plan', name: 'Plan Mode', description: 'Plans without changing anything' },
      ],
    },
  }))
  .onRequest('session/set_mode', async ({ params, client }) => {
    await update(client, params.sessionId, { sessionUpdate: 'current_mode_update', currentModeId: params.modeId });
    return {};
  })
  .onNotification('session/cancel', ({ params }) => {
    cancelled.add(params.sessionId);
  })
  .onRequest('session/prompt', async ({ params, client }) => {
    const { sessionId } = params;
    const text = params.prompt.map((b) => (b.type === 'text' ? b.text : '')).join(' ');
    cancelled.delete(sessionId);

    if (text.includes('fail')) {
      await stream(client, sessionId, 'agent_thought_chunk', 'this one is meant to go wrong.');
      throw RequestError.internalError(undefined, 'the fake agent failed on purpose');
    }

    if (text.includes('echo')) {
      const quoted = text.split('\n').filter((l) => l.startsWith('>')).length;
      await stream(client, sessionId, 'agent_message_chunk', `Got it: your message quoted ${quoted} line${quoted === 1 ? '' : 's'}.`);
      return { stopReason: 'end_turn' };
    }

    if (text.includes('several')) {
      for (const [n, change] of SEVERAL.entries()) {
        const toolCallId = `several-${n}`;
        const content = [{ type: 'diff' as const, ...change.diff }];
        await update(client, sessionId, { sessionUpdate: 'tool_call', toolCallId, title: `Edit ${change.diff.path}`, kind: 'edit', status: 'in_progress', content });
        await sleep(50);
        await update(client, sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: change.fails ? 'failed' : 'completed' });
      }
      await stream(client, sessionId, 'agent_message_chunk', 'Done: five files changed, and the lockfile left alone.');
      return { stopReason: 'end_turn' };
    }

    if (text.includes('slow')) {
      for (let i = 0; i < 600 && !cancelled.has(sessionId); i++) {
        await update(client, sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: `still thinking ${i}. ` } });
        await sleep(100);
      }
      return { stopReason: cancelled.has(sessionId) ? 'cancelled' : 'end_turn' };
    }

    await stream(client, sessionId, 'agent_thought_chunk', 'the user wants the readme to say what wrontend is. i will read it, then edit the first paragraph.');
    await update(client, sessionId, {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Read the readme', priority: 'high', status: 'in_progress' },
        { content: 'Rewrite the first paragraph', priority: 'high', status: 'pending' },
      ],
    });
    await update(client, sessionId, { sessionUpdate: 'tool_call', toolCallId: 'read-1', title: 'Read readme.md', kind: 'read', status: 'in_progress', rawInput: { file_path: 'readme.md' } });
    await sleep(300);
    await update(client, sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'read-1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '```markdown\n' + OLD + '```' } }],
    });
    await update(client, sessionId, {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Read the readme', priority: 'high', status: 'completed' },
        { content: 'Rewrite the first paragraph', priority: 'high', status: 'in_progress' },
      ],
    });

    const edit = { toolCallId: 'edit-1', title: 'Edit readme.md', kind: 'edit' as const, rawInput: { file_path: 'readme.md', old_string: 'wrontend is a frontend.', new_string: 'wrontend is a graphical frontend for terminal coding agents.' } };
    await update(client, sessionId, { sessionUpdate: 'tool_call', ...edit, status: 'pending' });
    const answer = await client.request('session/request_permission', {
      sessionId,
      toolCall: { ...edit, content: [{ type: 'diff', path: 'readme.md', oldText: OLD, newText: NEW }] },
      options: [
        { optionId: 'allow', name: 'Yes', kind: 'allow_once' },
        { optionId: 'always', name: 'Yes, and don’t ask again', kind: 'allow_always' },
        { optionId: 'reject', name: 'No', kind: 'reject_once' },
      ],
    });
    const allowed = answer.outcome.outcome === 'selected' && answer.outcome.optionId !== 'reject';
    await update(client, sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'edit-1',
      status: allowed ? 'completed' : 'failed',
      content: [{ type: 'diff', path: 'readme.md', oldText: OLD, newText: NEW }],
    });
    if (!allowed) {
      await stream(client, sessionId, 'agent_message_chunk', 'Understood, I left the readme as it was.');
      return { stopReason: 'end_turn' };
    }
    await update(client, sessionId, {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Read the readme', priority: 'high', status: 'completed' },
        { content: 'Rewrite the first paragraph', priority: 'high', status: 'completed' },
      ],
    });
    await update(client, sessionId, { sessionUpdate: 'usage_update', used: 21000, size: 65536 });
    await stream(client, sessionId, 'agent_message_chunk', ANSWER);
    return { stopReason: 'end_turn' };
  });

app.connect(ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
