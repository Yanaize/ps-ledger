# Adding a region

1. Add an entry in `server/src/config/regions.ts` (`locale`, `countryCode`, `languageCode`, currency, feature flags).
2. Extend `PriceRegion` / `CatalogRegion` unions in `shared/src/types.ts` if needed.
3. Confirm PlayStation concept pages and (for catalog) gameslist locale respond with 200.
4. For gift cards, map the region in the seller provider (e.g. Eneba slug).
5. Add UI labels in the web pages.
6. Re-run tests and a live smoke compare for one known title.
