// consecutive tool calls as one summary line, expandable into the single calls with their input, output and diffs

import { useState } from 'react';
import type { ToolCallContent, ToolKind } from '@agentclientprotocol/sdk';
import type { ToolItem } from '../state/transcript';
import { Counts, countContent, DiffView } from './Diff';
import { Icon } from './Icon';
import { InputView } from './InputView';
import { Leaf } from './Leaf';
import { Markdown } from './Markdown';

const VERBS: Record<string, [string, string, string]> = {
  // kind: [verb, singular noun, plural noun]
  read: ['Read', 'a file', 'files'],
  edit: ['Edited', 'a file', 'files'],
  delete: ['Deleted', 'a file', 'files'],
  move: ['Moved', 'a file', 'files'],
  search: ['Searched', 'once', 'times'],
  execute: ['Ran', 'a command', 'commands'],
  fetch: ['Fetched', 'a page', 'pages'],
  think: ['Thought', 'once', 'times'],
  other: ['Used', 'a tool', 'tools'],
};

function phrase(kind: string, n: number, first: boolean): string {
  const [verb, one, many] = VERBS[kind] ?? VERBS.other;
  const text = `${verb} ${n === 1 ? one : `${n} ${many}`}`;
  return first ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

export function summarise(tools: ToolItem[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) {
    const k = t.toolKind && VERBS[t.toolKind] ? t.toolKind : 'other';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n], i) => phrase(k, n, i === 0)).join(', ');
}

function textOf(content: ToolCallContent[]): string {
  return content
    .map((c) => (c.type === 'content' && c.content.type === 'text' ? c.content.text : ''))
    .filter(Boolean)
    .join('\n');
}

function ToolCard({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(false);
  const diffs = tool.content.filter((c) => c.type === 'diff');
  const output = textOf(tool.content);
  const failed = tool.status === 'failed';
  return (
    <div className={`tool-card${failed ? ' failed' : ''}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ToolIcon kind={tool.toolKind} />
        <span className="title">{tool.title}</span>
        <Counts counts={countContent(tool.content)} />
        <span className="tool-status mono">{failed ? 'failed' : tool.status === 'completed' ? '' : tool.status.replace('_', ' ')}</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
      </button>
      {open && (
        <div className="tool-body">
          {diffs.map((d, i) => d.type === 'diff' && <DiffView key={i} path={d.path} oldText={d.oldText} newText={d.newText} />)}
          {tool.rawInput !== undefined && diffs.length === 0 && (
            <details>
              <summary>Input</summary>
              <InputView input={tool.rawInput} />
            </details>
          )}
          {output && (
            <div className="tool-output">
              <Markdown text={output} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolIcon({ kind }: { kind: ToolKind | null }) {
  const colour = kind === 'edit' || kind === 'delete' || kind === 'move' ? 'var(--mustard)' : kind === 'execute' ? 'var(--accent)' : 'var(--olive)';
  return <Leaf size={8} color={colour} />;
}

export function ToolGroup({ tools, live }: { tools: ToolItem[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const running = tools.find((t) => t.status === 'pending' || t.status === 'in_progress');
  const counts = countContent(tools.flatMap((t) => t.content));
  return (
    <div className="tool-group">
      <button className="tool-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {running && live && <Leaf size={9} style={{ animation: 'sway 1.6s ease-in-out infinite' }} />}
        <span>{running && live ? running.title : summarise(tools)}</span>
        <Counts counts={counts} />
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
      </button>
      {open && (
        <div className="tool-list">
          {tools.map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
        </div>
      )}
    </div>
  );
}
