# Adding a gift-card seller

1. Implement `GiftCardProvider` in `server/src/providers/giftcards/`:
   - `id`, `displayName`
   - `supportsRegion`
   - `fetchListings(region)` → normalized listings (denomination, price, stock, URL)
   - Prefer official APIs / product feeds; respect robots.txt; do not bypass CAPTCHAs.
2. Register it in `createGiftCardRegistry` behind a config flag.
3. Document the source in `docs/data-sources.md` and README.
4. Add fixtures + unit tests for parsing.
5. Stock must be `unknown` unless the latest successful fetch explicitly says otherwise.
