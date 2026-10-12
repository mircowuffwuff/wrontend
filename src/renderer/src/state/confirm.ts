// one question at a time, asked over the dimmed app: the caller awaits the answer

import { create } from 'zustand';

export interface ConfirmRequest {
  title: string;
  message: string;
  // what the action stops or removes, one line each
  items?: string[];
  // the button that goes ahead, named for what it does
  action: string;
}

interface ConfirmState {
  request: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null;
}

export const useConfirm = create<ConfirmState>(() => ({ request: null }));

export function confirm(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    // a newer question replaces one still open, which counts as declined
    useConfirm.getState().request?.resolve(false);
    useConfirm.setState({ request: { ...request, resolve } });
  });
}

export function answer(ok: boolean): void {
  const { request } = useConfirm.getState();
  useConfirm.setState({ request: null });
  request?.resolve(ok);
}
