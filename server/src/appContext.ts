import os from 'node:os';
import type { Env } from './config/env.js';
import { resolveDbPath } from './config/env.js';
import { getProviderConfig } from './config/providers.js';
import { getRefreshConfig } from './config/refresh.js';
import { openDatabase, type Db } from './db/sqlite.js';
import { HttpClient } from './lib/http.js';
import {
  PlayStationStoreWebProvider,
  PsPlusGamesListProvider,
} from './providers/playstation/storeWeb.js';
import { createGiftCardRegistry } from './providers/giftcards/registry.js';
import { createExchangeProviders } from './providers/exchange/index.js';
import { ExchangeService } from './services/exchangeService.js';
import { GameSearchService } from './services/gameSearch.js';
import { PriceComparisonService } from './services/priceComparison.js';
import { GiftCardService } from './services/giftCardService.js';
import { CatalogService } from './services/catalogService.js';
import { RefreshScheduler } from './services/refreshScheduler.js';

export interface AppContext {
  env: Env;
  db: Db;
  http: HttpClient;
  ps: PlayStationStoreWebProvider;
  psPlus: PsPlusGamesListProvider;
  exchange: ExchangeService;
  gameSearch: GameSearchService;
  priceComparison: PriceComparisonService;
  giftCards: GiftCardService;
  catalog: CatalogService;
  refresh: RefreshScheduler;
  lanAddresses: string[];
}

export function createAppContext(env: Env): AppContext {
  const dbPath = resolveDbPath(env.DB_PATH);
  const db = openDatabase(dbPath);
  const providerCfg = getProviderConfig(env);
  const refreshConfig = getRefreshConfig(env);
  const http = new HttpClient({
    userAgent: providerCfg.userAgent,
    timeoutMs: providerCfg.timeoutMs,
    maxConcurrency: providerCfg.maxConcurrency,
  });

  const ps = new PlayStationStoreWebProvider(http, providerCfg.psSearchHash);
  const psPlus = new PsPlusGamesListProvider(http);
  const exchangeProvider = createExchangeProviders(http, providerCfg.exchangeProviders);
  const exchange = new ExchangeService(db, exchangeProvider, refreshConfig);
  const gameSearch = new GameSearchService(
    db,
    ps,
    providerCfg.psSearchRegion,
    refreshConfig,
  );
  const priceComparison = new PriceComparisonService(
    db,
    gameSearch,
    exchange,
    refreshConfig,
  );
  const giftProviders = createGiftCardRegistry(http, providerCfg.enebaEnabled);
  const giftCards = new GiftCardService(db, giftProviders, exchange, refreshConfig);
  const catalog = new CatalogService(db, psPlus, refreshConfig);
  // Seed curated popular rankings from any catalog already on disk
  try {
    catalog.reseedCuratedPopular();
  } catch {
    /* empty DB on first boot */
  }
  const refresh = new RefreshScheduler(db, refreshConfig, exchange, giftCards, catalog);

  return {
    env,
    db,
    http,
    ps,
    psPlus,
    exchange,
    gameSearch,
    priceComparison,
    giftCards,
    catalog,
    refresh,
    lanAddresses: listLanAddresses(),
  };
}

export function listLanAddresses(): string[] {
  const ifaces = os.networkInterfaces();
  const addrs: string[] = [];
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) {
        addrs.push(net.address);
      }
    }
  }
  return addrs;
}
