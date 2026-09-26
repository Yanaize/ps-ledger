# Replacing a data provider

Providers are isolated behind interfaces:

- `PlayStationStoreWebProvider` / `PsPlusGamesListProvider`
- `GiftCardProvider` registry
- `ExchangeRateProvider` chain

Steps:

1. Implement the same interface returning shared types (`SearchResultItem`, `ParsedEdition`, `RawGiftCardListing`, `ExchangeRateResult`).
2. Wire it in `appContext.ts` / registry factories.
3. Keep SQLite schema unchanged when possible — map into existing repositories.
4. Add fixtures under `server/test/` and mark UI data as unavailable if the provider fails (never fabricate).

Search hash recovery: DevTools on store.playstation.com → Network → `getSearchResults` → `extensions.persistedQuery.sha256Hash` → `.env` `PS_SEARCH_HASH`.
