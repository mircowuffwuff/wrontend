// the parts wrontend installs where the user first needs them, as the renderer sees them

export type ComponentState =
  | { status: 'missing' }
  // bytes: what has landed on disk so far -- npm reports no download progress of its own
  | { status: 'installing'; step: string; bytes: number }
  // version is null for a part built into wrontend, which has nothing to install
  | { status: 'installed'; version: string | null }
  | { status: 'failed'; error: string; detail: string };

export interface HarnessEntry {
  id: string;
  name: string;
  state: ComponentState;
}
