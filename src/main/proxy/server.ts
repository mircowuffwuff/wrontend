// the local proxy between every harness and Ollama: routes each request to the session's model, applies its settings, measures the traffic

import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { RequestStats, RouteSettings } from '@shared/proxy';
import { anthropic } from './anthropic';
import { openai } from './openai';
import type { Json, Meter, Shape } from './shape';

const SHAPES: Record<string, Shape> = {
  '/v1/messages': anthropic,
  '/v1/chat/completions': openai,
};

// request headers worth passing on -- credentials are the harness's business with Anthropic, never Ollama's
const FORWARD_HEADERS = ['content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'user-agent'];
const RETURN_HEADERS = ['content-type', 'cache-control'];

interface Route {
  settings: RouteSettings;
  onStats: (stats: RequestStats) => void;
}

export interface RouteHandle {
  readonly baseUrl: string;
  update(settings: Partial<RouteSettings>): void;
  dispose(): void;
}

export class ProxyServer {
  private server: Server | null = null;
  private port = 0;
  private readonly routes = new Map<string, Route>();

  // a function, so a changed Ollama address in Settings applies to the next request
  constructor(private readonly upstream: () => string) {}

  async start(): Promise<number> {
    if (this.server) return this.port;
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    return this.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  register(settings: RouteSettings, onStats: (stats: RequestStats) => void): RouteHandle {
    if (!this.server) throw new Error('the proxy is not running');
    const token = randomUUID();
    const route: Route = { settings: { ...settings }, onStats };
    this.routes.set(token, route);
    return {
      baseUrl: `http://127.0.0.1:${this.port}/s/${token}`,
      update: (next) => Object.assign(route.settings, next),
      dispose: () => this.routes.delete(token),
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://proxy');
    const match = /^\/s\/([^/]+)(\/.*)$/.exec(url.pathname);
    const route = match ? this.routes.get(match[1]) : undefined;
    if (!match || !route) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('no such route');
      return;
    }
    const path = match[2];
    const body = await readBody(req);
    const shape = req.method === 'POST' ? SHAPES[path] : undefined;

    let parsed: Json | null = null;
    if (shape) {
      try {
        parsed = JSON.parse(body.toString('utf8')) as Json;
      } catch {
        parsed = null;
      }
    }
    if (!shape || !parsed) {
      await this.forward(req, res, path + url.search, body.length ? body : undefined, null);
      return;
    }

    const started = Date.now();
    const { body: rewritten, kind, historyHasThinking } = shape.rewrite(parsed, route.settings);
    const stats: RequestStats = {
      kind,
      model: route.settings.model,
      status: 0,
      inputTokens: null,
      outputTokens: null,
      firstTokenMs: null,
      generationMs: null,
      historyHasThinking,
      error: null,
    };

    if (kind === 'background' && route.settings.backgroundPolicy !== 'pass') {
      const reply =
        route.settings.backgroundPolicy === 'local'
          ? shape.local(rewritten)
          : shape.error(400, 'background requests are turned off in wrontend');
      res.writeHead(reply.status, { 'content-type': reply.contentType }).end(reply.payload);
      route.onStats({ ...stats, status: reply.status });
      return;
    }

    const meter = shape.meter();
    const result = await this.forward(req, res, path + url.search, Buffer.from(JSON.stringify(rewritten)), {
      shape,
      meter,
      started,
    });
    route.onStats({ ...stats, ...result });
  }

  private async forward(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    body: Buffer | undefined,
    measure: { shape: Shape; meter: Meter; started: number } | null,
  ): Promise<Partial<RequestStats>> {
    const headers: Record<string, string> = {};
    for (const name of FORWARD_HEADERS) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }

    // a harness that hangs up -- Stop in the UI -- cancels the generation in Ollama too
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    let upstream: IncomingMessage;
    try {
      upstream = await send(`${this.upstream()}${path}`, req.method ?? 'GET', headers, body, controller.signal);
    } catch (cause) {
      const message = `Ollama is not reachable at ${this.upstream()}: ${(cause as Error).message}`;
      const reply = (measure?.shape ?? anthropic).error(502, message);
      if (!res.headersSent) res.writeHead(reply.status, { 'content-type': reply.contentType });
      res.end(reply.payload);
      return { status: reply.status, error: message };
    }

    const status = upstream.statusCode ?? 502;
    const out: Record<string, string> = {};
    for (const name of RETURN_HEADERS) {
      const value = upstream.headers[name];
      if (typeof value === 'string') out[name] = value;
    }
    res.writeHead(status, out);

    const streaming = (upstream.headers['content-type'] ?? '').includes('text/event-stream');
    const decoder = new TextDecoder();
    let whole = '';
    let firstAt: number | null = null;
    let error: string | null = null;
    try {
      for await (const chunk of upstream as AsyncIterable<Buffer>) {
        res.write(chunk);
        if (!measure) continue;
        const text = decoder.decode(chunk, { stream: true });
        if (streaming) {
          if (measure.meter.feed(text) && firstAt === null) firstAt = Date.now();
        } else {
          whole += text;
        }
      }
    } catch (cause) {
      error = controller.signal.aborted ? 'cancelled' : (cause as Error).message;
    }
    res.end();

    if (!measure) return {};
    const ended = Date.now();
    if (!streaming) measure.meter.whole(whole + decoder.decode());
    if (status >= 400 && !error) error = errorMessage(whole) ?? `Ollama answered ${status}`;
    return {
      status,
      ...measure.meter.usage(),
      firstTokenMs: firstAt === null ? null : firstAt - measure.started,
      generationMs: firstAt === null ? null : ended - firstAt,
      error,
    };
  }
}

// node's own http rather than fetch: fetch gives up when response headers take longer than five minutes, and Ollama sends none until it has read the whole prompt -- which on a slow card can take longer
function send(url: string, method: string, headers: Record<string, string>, body: Buffer | undefined, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const open = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = open(
      target,
      { method, headers: body ? { ...headers, 'content-length': String(body.length) } : headers, signal },
      resolve,
    );
    request.on('error', reject);
    request.end(body);
  });
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function errorMessage(text: string): string | null {
  try {
    const j = JSON.parse(text) as Json;
    const e = j.error as Json | string | undefined;
    if (typeof e === 'string') return e;
    if (typeof e?.message === 'string') return e.message;
  } catch {
    // not JSON
  }
  return null;
}
