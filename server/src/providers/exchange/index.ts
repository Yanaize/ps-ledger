import { ProviderError } from '../../lib/errors.js';
import { HttpClient } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';

export interface ExchangeRateResult {
  base: string;
  rates: Record<string, number>;
  provider: string;
  asOf: string;
}

export interface ExchangeRateProvider {
  id: string;
  getRates(base: string, quotes: string[]): Promise<ExchangeRateResult>;
}

export class FrankfurterProvider implements ExchangeRateProvider {
  readonly id = 'frankfurter';

  constructor(private readonly http: HttpClient) {}

  async getRates(base: string, quotes: string[]): Promise<ExchangeRateResult> {
    const symbols = quotes.filter((q) => q !== base).join(',');
    const url = `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${symbols}`;
    const res = await this.http.get(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new ProviderError('frankfurter', `HTTP ${res.status}`);
    const json = JSON.parse(res.text) as {
      base: string;
      date: string;
      rates: Record<string, number>;
    };
    return {
      base: json.base,
      rates: json.rates,
      provider: this.id,
      asOf: `${json.date}T00:00:00.000Z`,
    };
  }
}

export class ErApiProvider implements ExchangeRateProvider {
  readonly id = 'erapi';

  constructor(private readonly http: HttpClient) {}

  async getRates(base: string, quotes: string[]): Promise<ExchangeRateResult> {
    const url = `https://open.er-api.com/v6/latest/${base}`;
    const res = await this.http.get(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new ProviderError('erapi', `HTTP ${res.status}`);
    const json = JSON.parse(res.text) as {
      result: string;
      time_last_update_utc: string;
      rates: Record<string, number>;
    };
    if (json.result !== 'success') {
      throw new ProviderError('erapi', 'API returned unsuccessful result');
    }
    const rates: Record<string, number> = {};
    for (const q of quotes) {
      if (json.rates[q] != null) rates[q] = json.rates[q];
    }
    return {
      base,
      rates,
      provider: this.id,
      asOf: new Date(json.time_last_update_utc).toISOString(),
    };
  }
}

export class ChainedExchangeRateProvider implements ExchangeRateProvider {
  readonly id = 'chained';

  constructor(private readonly providers: ExchangeRateProvider[]) {}

  async getRates(base: string, quotes: string[]): Promise<ExchangeRateResult> {
    const errors: string[] = [];
    for (const p of this.providers) {
      try {
        const result = await p.getRates(base, quotes);
        const missing = quotes.filter((q) => q !== base && result.rates[q] == null);
        if (missing.length) {
          errors.push(`${p.id}: missing ${missing.join(',')}`);
          continue;
        }
        logger.info({ provider: p.id }, 'Exchange rates fetched');
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${p.id}: ${msg}`);
        logger.warn({ provider: p.id, err: msg }, 'Exchange provider failed');
      }
    }
    throw new ProviderError(
      'exchange',
      `All providers failed: ${errors.join(' | ')}`,
    );
  }
}

export function createExchangeProviders(
  http: HttpClient,
  ids: string[],
): ExchangeRateProvider {
  const map: Record<string, ExchangeRateProvider> = {
    frankfurter: new FrankfurterProvider(http),
    erapi: new ErApiProvider(http),
  };
  const list = ids.map((id) => map[id]).filter(Boolean);
  if (list.length === 0) {
    list.push(new FrankfurterProvider(http), new ErApiProvider(http));
  }
  return new ChainedExchangeRateProvider(list);
}
