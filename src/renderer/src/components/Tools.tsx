// consecutive tool calls as one summary line, expandable into the single calls with their input, output and diffs

import { useState } from 'react';
import type { ToolCallContent, ToolKind } from '@agentclientprotocol/sdk';
import type { ToolItem } from '../state/transcript';
import { CallDiffs, Counts, countContent } from './Diff';
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

// kinds counted by the files they touched rather than by their calls: two edits to one file are one edited file
const PER_FILE = new Set(['read', 'edit', 'delete']);

// a call names its files by its diffs and its locations; one that names none counts as a file of its own
function filesOf(t: ToolItem): string[] {
  const paths = new Set([...t.content.flatMap((c) => (c.type === 'diff' ? [c.path] : [])), ...(t.locations ?? []).map((l) => l.path)]);
  return paths.size ? [...paths] : [t.id];
}

// a failed call did nothing, so it counts only in a group where every call failed
export function succeeded(tools: ToolItem[]): ToolItem[] {
  const done = tools.filter((t) => t.status !== 'failed');
  return done.length ? done : tools;
}

export function summarise(tools: ToolItem[]): string {
  const counts = new Map<string, Set<string>>();
  for (const t of succeeded(tools)) {
    const k = t.toolKind && VERBS[t.toolKind] ? t.toolKind : 'other';
    const seen = counts.get(k) ?? new Set<string>();
    for (const key of PER_FILE.has(k) ? filesOf(t) : [t.id]) seen.add(key);
    counts.set(k, seen);
  }
  return [...counts].map(([k, seen], i) => phrase(k, seen.size, i === 0)).join(', ');
}

function textOf(content: ToolCallContent[]): string {
  return content
    .map((c) => (c.type === 'content' && c.content.type === 'text' ? c.content.text : ''))
    .filter(Boolean)
    .join('\n');
}

function ToolCard({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(false);
  const hasDiffs = tool.content.some((c) => c.type === 'diff');
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
          <CallDiffs content={tool.content} locations={tool.locations} />
          {tool.rawInput !== undefined && !hasDiffs && (
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
  const counts = countContent(succeeded(tools).flatMap((t) => t.content));
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
