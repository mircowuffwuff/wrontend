// the per-request settings the proxy applies, and the numbers it reports back

// placeholder model names a harness is configured with -- the proxy replaces them per request
export const MAIN_MODEL = 'wrontend-main';
export const BACKGROUND_MODEL = 'wrontend-background';

export type Effort = 'off' | 'on';

// what happens to a harness's side requests. 'local-titles' answers only title requests itself -- wrontend titles sessions on its own,
// and with one Ollama slot a title request can push the conversation out of the cache -- and passes the rest to the model
export const BACKGROUND_POLICIES = ['pass', 'local-titles', 'local', 'refuse'] as const;
export type BackgroundPolicy = (typeof BACKGROUND_POLICIES)[number];

export interface RouteSettings {
  model: string;
  effort: Effort;
  backgroundPolicy: BackgroundPolicy;
}

export interface RequestStats {
  kind: 'main' | 'background';
  model: string;
  status: number;
  inputTokens: number | null;
  outputTokens: number | null;
  // from the request reaching the proxy to the first streamed content
  firstTokenMs: number | null;
  // from the first streamed content to the end of the reply
  generationMs: number | null;
  // whether the outgoing history carried earlier thinking
  historyHasThinking: boolean;
  error: string | null;
}
