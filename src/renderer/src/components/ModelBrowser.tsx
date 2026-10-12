// the model browser: GGUF repos on Hugging Face, and a repo's quants, each with whether it fits on this machine. a large
// dialog over the dimmed app, like Settings -- the app store it is meant to become grows in the same place

import { useEffect, useState } from 'react';
import type { ComponentState } from '@shared/components';
import { sameModel, type Fit, type Quant, type RepoDetails, type RepoSummary } from '@shared/models';
import { bridge } from '../bridge';
import { useBrowser } from '../state/browser';
import { useOllama } from '../state/ollama';
import { errorText } from '../state/settings';
import { Icon } from './Icon';
import { Leaf } from './Leaf';

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

// memory as Windows and Ollama state it, in binary units: a 32 GB machine reads 32 GB, not 34.4
function memory(bytes: number): string {
  return `${(bytes / 2 ** 30).toFixed(1).replace(/\.0$/, '')} GB`;
}

// 6488262 -> 6.5M
function count(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

const FIT: Record<Fit, { label: string; tone: string }> = {
  gpu: { label: 'Fits on GPU', tone: 'good' },
  partial: { label: 'Partly on CPU', tone: 'warn' },
  'too-large': { label: 'Too large', tone: 'bad' },
};

function fitTitle(fit: Fit, context: number): string {
  const at = `at a ${context.toLocaleString('en-US')}-token context`;
  if (fit === 'gpu') return `Runs fully on the GPU ${at}`;
  if (fit === 'partial') return `Part of it runs on the CPU ${at}, which is slower`;
  return `Larger than the GPU memory and RAM together ${at}`;
}

// what a download comes to: Ollama announces each layer only as it starts on it, so the projector's size arrives once the
// weights are done; the repo's file sizes say the whole from the start
function expected(pull: ComponentState & { status: 'installing' }, quant: Quant, projectorBytes: number): number {
  return Math.max(pull.total ?? 0, quant.sizeBytes + projectorBytes, pull.bytes, 1);
}

export function ModelBrowser() {
  const close = useBrowser((s) => s.close);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RepoSummary[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [repo, setRepo] = useState<string | null>(null);

  // searches once the typing pauses; an answer to an older query is dropped
  useEffect(() => {
    let current = true;
    const timer = setTimeout(
      () =>
        void bridge.invoke('models:search', query).then(
          (found) => {
            if (!current) return;
            setResults(found);
            setSearchError(null);
          },
          (cause) => current && setSearchError(errorText(cause)),
        ),
      query ? 300 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [close]);

  const q = query.trim();
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings browser" role="dialog" aria-modal="true" aria-label="Models">
        <nav className="settings-nav browser-results">
          <label className="search">
            <Icon name="search" size={16} />
            <input autoFocus placeholder="Search Hugging Face" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="settings-area-label">{q ? 'Results' : 'Most downloaded'}</div>
          {searchError && <p className="browser-note error">{searchError}</p>}
          {!searchError && results === null && <p className="browser-note">Searching…</p>}
          {!searchError && results?.length === 0 && <p className="browser-note">Nothing on Hugging Face matches “{q}”.</p>}
          {results?.map((r) => {
            const [owner, name] = r.id.split('/');
            return (
              <button key={r.id} className={`repo-row${r.id === repo ? ' active' : ''}`} onClick={() => setRepo(r.id)}>
                <span className="repo-name">
                  <span className="muted">{owner}/</span>
                  {name}
                </span>
                <span className="repo-meta">
                  {[r.parameters ? `${(r.parameters / 1e9).toFixed(1)}B` : null, r.architecture, `${count(r.downloads)} downloads`, `${count(r.likes)} likes`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="settings-content browser-page">
          <button className="icon-button settings-close" aria-label="Close" title="Close" onClick={close}>
            <Icon name="close" />
          </button>
          {repo ? (
            <RepoPage key={repo} repo={repo} />
          ) : (
            <div className="browser-intro">
              <Leaf size={20} />
              <h2>Find a model</h2>
              <p className="setting-description">Search Hugging Face for GGUF models, then pick a repo to see its quants and which of them fit on this computer.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RepoPage({ repo }: { repo: string }) {
  const models = useOllama((s) => s.models);
  const pulls = useBrowser((s) => s.pulls);
  const [details, setDetails] = useState<RepoDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    void bridge.invoke('models:repo', repo).then(
      (found) => {
        setDetails(found);
        setPicked(found.recommended ?? found.quants[0]?.tag ?? null);
      },
      (cause) => setError(errorText(cause)),
    );
  }, [repo]);

  const installed = (q: Quant) => models.some((m) => sameModel(m.name, q.name));
  const pullOf = (q: Quant) => Object.entries(pulls).find(([name]) => sameModel(name, q.name))?.[1] ?? null;

  if (error) return <p className="browser-note error">{error}</p>;
  if (!details) return <p className="browser-note">Reading {repo}…</p>;

  const { hardware } = details;
  const context = hardware?.contextLength ?? 0;
  const quant = details.quants.find((q) => q.tag === picked) ?? null;
  return (
    <div className="repo-page">
      <header className="repo-head">
        <h2 className="mono">{repo}</h2>
        <p className="setting-description">
          {hardware
            ? `Measured against ${memory(hardware.gpuBytes)} of GPU memory and ${memory(hardware.ramBytes)} of RAM, at a ${context.toLocaleString('en-US')}-token context.`
            : 'wrontend cannot see the hardware Ollama runs on, so it does not say what fits.'}
          {details.projectorBytes > 0 && ` Each download includes the ${gb(details.projectorBytes)} vision projector.`}
        </p>
      </header>
      {details.quants.length === 0 ? (
        <p className="browser-note">This repo has no single-file GGUF quants Ollama can pull.</p>
      ) : (
        <div className="quant-list" role="radiogroup" aria-label="Quants">
          {details.quants.map((q) => {
            const pull = pullOf(q);
            return (
              <button key={q.tag} role="radio" aria-checked={q.tag === picked} className={`quant-row${q.tag === picked ? ' picked' : ''}`} onClick={() => setPicked(q.tag)}>
                <span className="quant-tag mono">{q.tag}</span>
                {q.tag === details.recommended && <span className="badge accent">Recommended</span>}
                {installed(q) && <span className="badge">Installed</span>}
                <span className="spacer" />
                {pull?.status === 'installing' && pull.bytes > 0 ? (
                  <span className="quant-progress mono">{Math.floor((pull.bytes / expected(pull, q, details.projectorBytes)) * 100)}%</span>
                ) : null}
                {q.fit && (
                  <span className={`fit ${FIT[q.fit].tone}`} title={fitTitle(q.fit, context)}>
                    {FIT[q.fit].label}
                  </span>
                )}
                <span className="quant-size mono">{gb(q.sizeBytes)}</span>
              </button>
            );
          })}
        </div>
      )}
      {quant && <PullBar quant={quant} projectorBytes={details.projectorBytes} installed={installed(quant)} pull={pullOf(quant)} />}
    </div>
  );
}

// the picked quant: its download button, its progress while it downloads, or why it failed
function PullBar({ quant, projectorBytes, installed, pull }: { quant: Quant; projectorBytes: number; installed: boolean; pull: ComponentState | null }) {
  const [open, setOpen] = useState(false);
  const download = () => void bridge.invoke('models:pull', quant.name);

  if (pull?.status === 'installing') {
    const total = expected(pull, quant, projectorBytes);
    const share = pull.bytes / total;
    return (
      <div className="pull-bar">
        <div className="pull-text">
          <span>
            {pull.step === 'Downloading' ? `Downloading ${quant.tag} · ${gb(pull.bytes)} of ${gb(total)}` : `${pull.step} ${quant.tag}…`}
          </span>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(share * 100)}>
            <div style={{ width: `${share * 100}%` }} />
          </div>
        </div>
        <button className="button" onClick={() => void bridge.invoke('models:cancel-pull', quant.name)}>
          Cancel
        </button>
      </div>
    );
  }
  if (pull?.status === 'failed') {
    return (
      <div className="pull-bar failed">
        <div className="pull-text">
          <button className="tool-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <Leaf size={9} color="var(--remove)" />
            <span>{pull.error}</span>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
          </button>
          {open && <pre className="mono">{pull.detail}</pre>}
        </div>
        <button className="button primary" onClick={download}>
          Try Again
        </button>
      </div>
    );
  }
  return (
    <div className="pull-bar">
      <div className="pull-text">
        <span className="mono">{quant.name}</span>
        <span className="setting-description">
          {installed ? 'In Ollama, and in the model picker.' : `${gb(quant.sizeBytes + projectorBytes)} to download${projectorBytes > 0 ? ', with the projector' : ''}.`}
        </span>
      </div>
      <button className="button primary" disabled={installed} onClick={download}>
        <Icon name="download" size={16} />
        {installed ? 'Installed' : 'Download'}
      </button>
    </div>
  );
}
