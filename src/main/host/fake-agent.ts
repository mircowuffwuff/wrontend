// a scripted ACP agent for testing the app without a model: thinking, a plan, markdown, a read, an edit that needs permission.
// a prompt containing "slow" streams thinking until it is cancelled, one containing "fail" ends the turn with an error,
// one containing "echo" answers with how many quoted lines it carried, and one containing "several" writes and edits
// several files in the session's folder

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { agent, ndJsonStream, PROTOCOL_VERSION, RequestError, type AgentContext, type SessionUpdate } from '@agentclientprotocol/sdk';
import { structuredPatch } from 'diff';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cancelled = new Set<string>();
// each session's project folder, where "several" writes its files
const folders = new Map<string, string>();

const OLD = '# readme\n\nwrontend is a frontend.\n\n## usage\n\nrun it.\n';
const NEW = '# readme\n\nwrontend is a graphical frontend for terminal coding agents.\n\n## usage\n\nrun it.\n';

// the files a prompt containing "several" finds in the session's folder, and its edits to them: five files, one of
// them edited three times, two of them created, and one edit that fails. old is null for a file the edit creates
const SEEDS: Record<string, string> = {
  'src/app.ts': [
    "import { listen } from './server';",
    "import { log } from './log';",
    '',
    'const port = 3000;',
    '',
    'export function start() {',
    '  listen(port);',
    '}',
    '',
    'export function stop() {',
    '  close();',
    '}',
    '',
    'export function restart() {',
    '  stop();',
    '  start();',
    '}',
    '',
    "export const name = 'app';",
    '',
  ].join('\n'),
  'src/view.ts': "export const title = 'app';\n",
  'package.json': '{\n  "scripts": {\n    "start": "node app.js"\n  }\n}\n',
};
const SEVERAL: { path: string; old: string | null; new: string; fails?: boolean }[] = [
  { path: 'src/app.ts', old: 'const port = 3000;', new: 'const port = Number(process.env.PORT ?? 3000);' },
  { path: 'src/view.ts', old: "export const title = 'app';", new: "export const title = 'wrontend';\nexport const subtitle = 'a frontend';" },
  { path: 'package-lock.json', old: '{}', new: '{ "lockfileVersion": 3 }', fails: true },
  { path: 'docs/usage.md', old: null, new: '# usage\n\nrun it with npm start.\n' },
  { path: 'src/app.ts', old: '  listen(port);', new: '  listen(port, () => log(`listening on ${port}`));' },
  { path: 'src/log.ts', old: null, new: 'export const log = console.log;\n' },
  { path: 'src/app.ts', old: "export const name = 'app';", new: "export const name = 'wrontend';" },
  { path: 'package.json', old: '"start": "node app.js"', new: '"start": "node dist/app.js"' },
];

// one edit as Claude Code reports it: the file is written, then each hunk of the change goes out as a diff with three
// lines of context, and a location per diff names the line its hunk starts on
async function editFile(client: AgentContext, sessionId: string, folder: string, n: number, change: (typeof SEVERAL)[number]) {
  const path = join(folder, change.path);
  const toolCallId = `several-${n}`;
  await update(client, sessionId, { sessionUpdate: 'tool_call', toolCallId, title: `Edit ${change.path}`, kind: 'edit', status: 'in_progress', locations: [{ path }] });
  await sleep(50);
  if (change.fails) {
    const content = [{ type: 'diff' as const, path, oldText: change.old, newText: change.new }];
    await update(client, sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed', content });
    return;
  }
  const before = change.old === null ? '' : await readFile(path, 'utf8');
  const after = change.old === null ? change.new : before.replace(change.old, change.new);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, after);
  const side = (lines: string[], drop: string) => lines.filter((l) => l[0] !== drop && l[0] !== '\\').map((l) => l.slice(1)).join('\n');
  const hunks = structuredPatch(path, path, before, after, '', '', { context: 3 }).hunks;
  await update(client, sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId,
    status: 'completed',
    content: hunks.map((h) => ({ type: 'diff' as const, path, oldText: side(h.lines, '+') || null, newText: side(h.lines, '-') })),
    locations: hunks.map((h) => ({ path, line: h.newStart })),
  });
}

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
  .onRequest('session/new', ({ params }) => {
    const sessionId = `fake-${Date.now()}`;
    folders.set(sessionId, params.cwd);
    return {
      sessionId,
      modes: {
        currentModeId: 'default',
        availableModes: [
          { id: 'default', name: 'Default', description: 'Asks before edits and commands' },
          { id: 'plan', name: 'Plan Mode', description: 'Plans without changing anything' },
        ],
      },
    };
  })
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
      const folder = folders.get(sessionId)!;
      for (const [path, text] of Object.entries(SEEDS)) {
        await mkdir(dirname(join(folder, path)), { recursive: true });
        await writeFile(join(folder, path), text);
      }
      for (const [n, change] of SEVERAL.entries()) await editFile(client, sessionId, folder, n, change);
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
