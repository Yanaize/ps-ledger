import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../appContext.js';
import { AppError } from '../lib/errors.js';
import { getRefreshJobs } from '../db/repositories/meta.js';
import { getPref, setPref } from '../db/repositories/catalog.js';
import { upsertManualMatch } from '../db/repositories/games.js';
import type { DatasetId } from '../config/refresh.js';
import type { CatalogRegion, CurrencyCode, PriceRegion } from '@ps-price-compare/shared';

function ownerIdFrom(req: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = req.headers['x-ps-ledger-user'];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new AppError('Missing user', 'BAD_REQUEST', 400);
  }
  return id;
}

function parseWalletOverrides(raw: string | undefined): Record<string, number> | undefined {
  if (!raw) return undefined;
  const out: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [region, value] = part.split(':');
    if (!region) continue;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) continue;
    out[region] = Math.round(amount);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function registerRoutes(app: FastifyInstance, ctx: AppContext) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: err.code,
        message: err.message,
        details: err.details,
      });
    }
    ctx.env;
    app.log.error(err);
    return reply.status(500).send({
      error: 'INTERNAL',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  });

  app.get('/api/status', async () => {
    // Opening the site kicks a background stale check (no-op if data is fresh)
    void ctx.refresh.refreshStaleDatasets('status').catch((err) => {
      app.log.warn({ err }, 'Background stale refresh failed');
    });

    const jobs = getRefreshJobs(ctx.db);
    const datasets = Object.fromEntries(
      jobs.map((j) => [
        j.dataset,
        {
          lastAttemptAt: j.last_attempt_at,
          lastSuccessAt: j.last_success_at,
          status: j.status,
          message: j.message,
        },
      ]),
    );
    const deg = ctx.ps.isSearchDegraded();
    return {
      serverTime: new Date().toISOString(),
      bindHost: ctx.env.BIND_HOST,
      port: ctx.env.PORT,
      lanUrls: ctx.lanAddresses.map((ip) => `http://${ip}:${ctx.env.PORT}`),
      datasets,
      searchDegraded: deg.degraded,
      searchDegradedReason: deg.reason,
      enebaEnabled: ctx.env.GIFTCARD_ENEBA_ENABLED,
      autoRefreshStaleHours: ctx.env.AUTO_REFRESH_STALE_HOURS,
      autoRefreshCheckMinutes: ctx.env.AUTO_REFRESH_CHECK_MINUTES,
    };
  });

  app.get<{ Querystring: { q?: string } }>('/api/games/search', async (req) => {
    const q = String(req.query.q ?? '');
    return ctx.gameSearch.search(q);
  });

  app.get<{
    Querystring: { productId?: string };
  }>('/api/games/resolve-concept', async (req) => {
    const productId = String(req.query.productId ?? '');
    if (!productId) {
      throw new AppError('productId required', 'BAD_REQUEST', 400);
    }
    const conceptId = await ctx.gameSearch.resolveConceptId(productId);
    return { productId, conceptId };
  });

  app.get<{
    Params: { conceptId: string };
    Querystring: { useGiftCards?: string; baseProductId?: string; wallets?: string };
  }>('/api/games/:conceptId/compare', async (req) => {
    return ctx.priceComparison.compare(req.params.conceptId, {
      useGiftCards: req.query.useGiftCards === '1' || req.query.useGiftCards === 'true',
      baseProductId: req.query.baseProductId,
      walletOverrides: parseWalletOverrides(req.query.wallets),
    });
  });

  app.get<{
    Params: { conceptId: string };
    Querystring: {
      regions?: string;
      range?: string;
      mode?: string;
      productIds?: string;
    };
  }>('/api/games/:conceptId/history', async (req) => {
    const regions = String(req.query.regions ?? 'IL,JP,IN,TR')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean) as PriceRegion[];
    const range = (req.query.range ?? 'ALL') as '1M' | '3M' | '6M' | '1Y' | 'ALL';
    const mode = (req.query.mode ?? 'native') as 'native' | 'ils';
    const productIds = req.query.productIds
      ? String(req.query.productIds)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    return ctx.priceHistory.getChart({
      conceptId: req.params.conceptId,
      regions: regions.length ? regions : ['IL', 'JP', 'IN', 'TR'],
      range,
      mode,
      productIds,
    });
  });

  app.get<{
    Params: { conceptId: string };
    Querystring: { productId?: string; region?: string };
  }>('/api/games/:conceptId/history/summary', async (req) => {
    const productId = String(req.query.productId ?? '');
    const region = String(req.query.region ?? '') as PriceRegion;
    if (!productId || !region) {
      throw new AppError('productId and region required', 'BAD_REQUEST', 400);
    }
    return ctx.priceHistory.getSummary(productId, region);
  });

  app.get('/api/watchlist', async (req) => {
    const items = await ctx.watchlist.list(ownerIdFrom(req));
    return { items };
  });

  app.get<{ Params: { conceptId: string } }>('/api/watchlist/:conceptId', async (req) => {
    return { item: await ctx.watchlist.get(ownerIdFrom(req), req.params.conceptId) };
  });

  app.post<{
    Body: {
      conceptId: string;
      title: string;
      coverUrl?: string | null;
      preferredProductId?: string | null;
    };
  }>('/api/watchlist', async (req) => {
    const { conceptId, title, coverUrl, preferredProductId } = req.body ?? {};
    if (!conceptId || !title) {
      throw new AppError('conceptId and title required', 'BAD_REQUEST', 400);
    }
    const item = await ctx.watchlist.add(ownerIdFrom(req), {
      conceptId,
      title,
      coverUrl,
      preferredProductId,
    });
    return { ok: true, item };
  });

  app.delete<{ Params: { conceptId: string } }>('/api/watchlist/:conceptId', async (req) => {
    ctx.watchlist.remove(ownerIdFrom(req), req.params.conceptId);
    return {
      ok: true,
      tracked: ctx.priceHistory.getTracking(req.params.conceptId)?.active === 1,
    };
  });

  app.get('/api/alerts/unread', async () => {
    return { count: ctx.alerts.unreadCount() };
  });

  app.get<{ Querystring: { unread?: string } }>('/api/alerts', async (req) => {
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    return { items: ctx.alerts.list(unreadOnly), unread: ctx.alerts.unreadCount() };
  });

  app.post('/api/alerts/read-all', async () => {
    ctx.alerts.viewAll();
    return { ok: true, unread: 0 };
  });

  app.post<{ Params: { id: string } }>('/api/alerts/:id/read', async (req) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new AppError('invalid id', 'BAD_REQUEST', 400);
    ctx.alerts.view(id);
    return { ok: true, unread: ctx.alerts.unreadCount() };
  });

  app.get<{ Params: { conceptId: string } }>('/api/alerts/rules/:conceptId', async (req) => {
    return { rules: ctx.alerts.rulesFor(req.params.conceptId) };
  });

  app.put<{
    Params: { conceptId: string };
    Body: {
      belowIlsMinor?: number | null;
      discountPct?: number | null;
      lowestRecorded?: boolean;
      saleStarted?: boolean;
    };
  }>('/api/alerts/rules/:conceptId', async (req) => {
    const body = req.body ?? {};
    const rules = ctx.alerts.saveRules(req.params.conceptId, {
      belowIlsMinor: body.belowIlsMinor ?? null,
      discountPct: body.discountPct ?? null,
      lowestRecorded: Boolean(body.lowestRecorded),
      saleStarted: Boolean(body.saleStarted),
    });
    return { ok: true, rules };
  });

  app.get('/api/wallets', async () => {
    return { wallets: ctx.wallets.list() };
  });

  app.put<{
    Params: { region: string };
    Body: { balanceMinor?: number };
  }>('/api/wallets/:region', async (req) => {
    const balanceMinor = Number(req.body?.balanceMinor);
    if (!Number.isFinite(balanceMinor)) {
      throw new AppError('balanceMinor required', 'BAD_REQUEST', 400);
    }
    try {
      const wallet = ctx.wallets.set(req.params.region, balanceMinor);
      return { ok: true, wallet };
    } catch (err) {
      throw new AppError(err instanceof Error ? err.message : 'Invalid wallet', 'BAD_REQUEST', 400);
    }
  });

  app.get('/api/tracking', async () => {
    return {
      games: ctx.priceHistory.listTracking(false),
      status: ctx.priceHistory.trackingStatus(ctx.env.PRICE_HISTORY_INTERVAL_HOURS * 3600_000),
    };
  });

  app.get<{ Params: { conceptId: string } }>('/api/tracking/:conceptId', async (req) => {
    return {
      tracking: ctx.priceHistory.getTracking(req.params.conceptId) ?? null,
    };
  });

  app.post<{
    Body: {
      conceptId: string;
      title: string;
      coverUrl?: string | null;
      preferredProductId?: string | null;
    };
  }>('/api/tracking', async (req) => {
    const { conceptId, title, coverUrl, preferredProductId } = req.body ?? {};
    if (!conceptId || !title) {
      throw new AppError('conceptId and title required', 'BAD_REQUEST', 400);
    }
    const tracking = ctx.priceHistory.track({
      conceptId,
      title,
      coverUrl,
      preferredProductId,
    });
    return { ok: true, tracking };
  });

  app.delete<{ Params: { conceptId: string } }>('/api/tracking/:conceptId', async (req) => {
    const tracking = ctx.priceHistory.untrack(req.params.conceptId);
    return { ok: true, tracking };
  });

  app.post<{ Params: { conceptId: string } }>(
    '/api/tracking/:conceptId/refresh',
    async (req) => {
      const conceptId = req.params.conceptId;
      const tracked = ctx.priceHistory.getTracking(conceptId);
      if (!tracked?.active) {
        // Allow one-off refresh even if not tracked — still records history
      }
      await Promise.all(
        (['IL', 'JP', 'IN', 'TR'] as PriceRegion[]).map((region) =>
          ctx.gameSearch.loadAndCacheConcept(region, conceptId),
        ),
      );
      return { ok: true };
    },
  );

  app.post('/api/tracking/collect', async () => {
    const result = await ctx.priceCollector.run('manual');
    return { ok: true, result };
  });

  app.post<{
    Params: { conceptId: string };
    Body: {
      region: PriceRegion;
      baseProductId: string;
      matchedProductId: string | null;
      reason?: string;
    };
  }>('/api/games/:conceptId/matches', async (req) => {
    const { region, baseProductId, matchedProductId, reason } = req.body;
    upsertManualMatch(
      ctx.db,
      req.params.conceptId,
      region,
      baseProductId,
      matchedProductId,
      reason ?? 'Manual override',
    );
    return { ok: true };
  });

  app.get<{
    Querystring: { region?: PriceRegion; provider?: string; inStock?: string };
  }>('/api/giftcards', async (req) => {
    return {
      listings: await ctx.giftCards.list({
        region: req.query.region,
        provider: req.query.provider,
        inStockOnly: req.query.inStock === '1' || req.query.inStock === 'true',
      }),
    };
  });

  app.get('/api/giftcards/summary', async () => {
    return { summaries: await ctx.giftCards.summaries() };
  });

  app.post<{
    Body: {
      region: PriceRegion;
      denomMajor: number;
      sellerName: string;
      productUrl: string;
      priceMajor: number;
      priceCurrency: CurrencyCode;
      stockStatus: 'in_stock' | 'out_of_stock' | 'unknown';
    };
  }>('/api/giftcards/manual', async (req) => {
    const id = ctx.giftCards.addManual(req.body);
    return { ok: true, id };
  });

  app.get<{
    Querystring: {
      view?: string;
      search?: string;
      sort?: 'name' | 'regions' | 'popular';
    };
  }>('/api/catalog', async (req) => {
    return ctx.catalog.getMatrix({
      view: req.query.view as
        | 'popular'
        | 'full'
        | 'differences'
        | 'all_regions'
        | CatalogRegion
        | undefined,
      search: req.query.search,
      sort: req.query.sort,
    });
  });

  app.get('/api/rates', async () => {
    return ctx.exchange.getSnapshot();
  });

  app.post<{ Params: { dataset: string } }>('/api/refresh/:dataset', async (req) => {
    const dataset = req.params.dataset as DatasetId;
    const allowed = ['prices', 'giftcards', 'catalog', 'rates', 'all'];
    if (!allowed.includes(dataset)) {
      throw new AppError(`Unknown dataset: ${dataset}`, 'BAD_REQUEST', 400);
    }
    return ctx.refresh.refresh(dataset);
  });

  app.get('/api/prefs', async () => {
    return {
      starredConcepts: (getPref(ctx.db, 'starredConcepts') as string[] | null) ?? [],
      useGiftCardsDefault: Boolean(getPref(ctx.db, 'useGiftCardsDefault') ?? false),
      hiddenCatalogRegions:
        (getPref(ctx.db, 'hiddenCatalogRegions') as string[] | null) ?? [],
      minSavingsIlsMinor: Number(getPref(ctx.db, 'minSavingsIlsMinor') ?? 3000),
      minSavingsPct: Number(getPref(ctx.db, 'minSavingsPct') ?? 10),
      theme: (getPref(ctx.db, 'theme') as string | null) ?? 'playstation',
      accent: (getPref(ctx.db, 'accent') as string | null) ?? 'theme',
      followSystem: Boolean(getPref(ctx.db, 'followSystem') ?? false),
      highContrast: Boolean(getPref(ctx.db, 'highContrast') ?? false),
      customAccent: (getPref(ctx.db, 'customAccent') as string | null) ?? null,
    };
  });

  app.put<{
    Body: {
      starredConcepts?: string[];
      useGiftCardsDefault?: boolean;
      hiddenCatalogRegions?: string[];
      minSavingsIlsMinor?: number;
      minSavingsPct?: number;
      theme?: string;
      accent?: string;
      followSystem?: boolean;
      highContrast?: boolean;
      customAccent?: string | null;
    };
  }>('/api/prefs', async (req) => {
    if (req.body.starredConcepts) {
      setPref(ctx.db, 'starredConcepts', req.body.starredConcepts);
    }
    if (req.body.useGiftCardsDefault != null) {
      setPref(ctx.db, 'useGiftCardsDefault', req.body.useGiftCardsDefault);
    }
    if (req.body.hiddenCatalogRegions) {
      setPref(ctx.db, 'hiddenCatalogRegions', req.body.hiddenCatalogRegions);
    }
    if (req.body.minSavingsIlsMinor != null) {
      setPref(ctx.db, 'minSavingsIlsMinor', req.body.minSavingsIlsMinor);
    }
    if (req.body.minSavingsPct != null) {
      setPref(ctx.db, 'minSavingsPct', req.body.minSavingsPct);
    }
    if (req.body.theme) setPref(ctx.db, 'theme', req.body.theme);
    if (req.body.accent) setPref(ctx.db, 'accent', req.body.accent);
    if (req.body.followSystem != null) setPref(ctx.db, 'followSystem', req.body.followSystem);
    if (req.body.highContrast != null) setPref(ctx.db, 'highContrast', req.body.highContrast);
    if (req.body.customAccent !== undefined) setPref(ctx.db, 'customAccent', req.body.customAccent);
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true }));
}
