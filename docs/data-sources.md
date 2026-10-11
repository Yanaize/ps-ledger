# Data sources (verified)

## PlayStation Store search

- Endpoint: `GET https://web.np.playstation.com/api/graphql/v1/op`
- Operation: `getSearchResults` with persisted query hash (`PS_SEARCH_HASH`)
- Raw GraphQL query text is rejected (`Query not whitelisted`)

## PlayStation concept / price

- `https://store.playstation.com/{locale}/concept/{conceptId}`
- Parse `__NEXT_DATA__` → batarangs → `env:*` JSON caches for `Product`, `GameCTA` prices (`basePriceValue`, `discountedValue`, `currencyCode`)

Cross-region key: **conceptId** (global). Japan product IDs use `JP9000-…`; IN/TR/IL often share `EP9000-…`. Matching uses product ID → SKU suffix → edition/platform → title fallback.

## PS Plus Extra catalog

- `https://www.playstation.com/bin/imagic/gameslist?locale={locale}&categoryList=plus-games-list`
- Locales: `ja-jp`, `en-in`, `en-tr`, `en-il` (`he-il` returns 404)

## Gift cards (Eneba)

- `https://www.eneba.com/store/gift-cards?drms[]=psn&regions[]={japan|india|turkey}`
- robots.txt allows `/store/...` (disallows `/search` — do not scrape search)
- Parse `__APOLLO_STATE__` Product + Auction (`isInStock`, ILS price in minor units)

## Exchange rates

1. Frankfurter `https://api.frankfurter.dev/v1/latest?base=ILS&symbols=JPY,INR,TRY,USD,EUR`
2. Fallback `https://open.er-api.com/v6/latest/ILS`

Bank of Israel Public API lacks INR/TRY — not used as primary.
