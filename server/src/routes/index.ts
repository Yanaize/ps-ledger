import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../appContext.js';
import { AppError } from '../lib/errors.js';
import { getRefreshJobs } from '../db/repositories/meta.js';
import { getPref, setPref } from '../db/repositories/catalog.js';
import { upsertManualMatch } from '../db/repositories/games.js';
import type { DatasetId } from '../config/refresh.js';
import type { CatalogRegion, CurrencyCode, PriceRegion } from '@ps-price-compare/shared';

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
    Querystring: { useGiftCards?: string; baseProductId?: string };
  }>('/api/games/:conceptId/compare', async (req) => {
    return ctx.priceComparison.compare(req.params.conceptId, {
      useGiftCards: req.query.useGiftCards === '1' || req.query.useGiftCards === 'true',
      baseProductId: req.query.baseProductId,
    });
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
    };
  });

  app.put<{
    Body: {
      starredConcepts?: string[];
      useGiftCardsDefault?: boolean;
      hiddenCatalogRegions?: string[];
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
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true }));
}
