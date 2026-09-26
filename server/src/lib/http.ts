import { ProviderError } from './errors.js';
import { logger } from './logger.js';

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs: number;
  maxConcurrency: number;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  headers: Headers;
  text: string;
  blocked: boolean;
}

export class HttpClient {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly opts: HttpClientOptions) {}

  async get(url: string, init?: RequestInit): Promise<FetchResult> {
    await this.acquire();
    try {
      return await this.request(url, { ...init, method: 'GET' });
    } finally {
      this.release();
    }
  }

  async request(url: string, init?: RequestInit): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'user-agent': this.opts.userAgent,
          accept: 'text/html,application/json,*/*',
          'accept-language': 'en-US,en;q=0.9',
          ...(init?.headers ?? {}),
        },
        redirect: 'follow',
      });
      const text = await res.text();
      const blocked = isBlockedResponse(res.status, text);
      if (blocked) {
        logger.warn({ url, status: res.status }, 'HTTP response looks blocked/challenged');
      }
      return {
        ok: res.ok && !blocked,
        status: res.status,
        url: res.url,
        headers: res.headers,
        text,
        blocked,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError('http', `Request failed: ${message}`, { url });
    } finally {
      clearTimeout(timer);
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.opts.maxConcurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

export function isBlockedResponse(status: number, body: string): boolean {
  if (status === 403 || status === 429) return true;
  const sample = body.slice(0, 4000).toLowerCase();
  return (
    sample.includes('just a moment') ||
    sample.includes('cf-browser-verification') ||
    sample.includes('challenge-platform') ||
    sample.includes('attention required') ||
    sample.includes('access denied') ||
    sample.includes('are you a human')
  );
}

export function extractScriptJson(html: string, scriptId: string): unknown {
  const re = new RegExp(
    `<script[^>]*id=["']${scriptId}["'][^>]*>([\\s\\S]*?)</script>`,
    'i',
  );
  const m = html.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export function extractNextData(html: string): unknown {
  return extractScriptJson(html, '__NEXT_DATA__');
}

export function extractApolloState(html: string): unknown {
  return extractScriptJson(html, '__APOLLO_STATE__');
}

/** Extract env:UUID script JSON blobs from batarang HTML text */
export function extractEnvCaches(batarangText: string): unknown[] {
  const results: unknown[] = [];
  const re =
    /<script id="env:[^"]+" type="application\/json">([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(batarangText))) {
    try {
      results.push(JSON.parse(m[1]));
    } catch {
      /* skip */
    }
  }
  return results;
}
