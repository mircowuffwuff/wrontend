// the parts wrontend installs where they are first needed, and the state each is in

export type ComponentState =
  | { status: 'missing' }
  // bytes: what has landed on disk so far -- npm reports no download progress of its own. total: the size when it is known
  | { status: 'installing'; step: string; bytes: number; total?: number }
  // version is null for a part built into wrontend, which has nothing to install
  | { status: 'installed'; version: string | null }
  | { status: 'failed'; error: string; detail: string };

export interface HarnessEntry {
  id: string;
  name: string;
  state: ComponentState;
}
