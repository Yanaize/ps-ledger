# PS Price Compare

Locally hosted web app for comparing PlayStation 5 game prices, PlayStation gift-card costs, and PS Plus Extra catalogs across regions — with all financial comparisons in Israeli Shekels (₪).

**Not for public internet hosting.** Bind to your LAN only.

## 1. What it does

1. **Price Comparison** — search a PS5 game and compare Japan / India / Turkey store prices in ₪, with optional gift-card funding estimates.
2. **Gift Cards** — compare PSN gift-card denominations and sellers for JP / IN / TR (markup vs market FX, stock, effective credit rate).
3. **PS Plus Extra Catalog** — interactive spreadsheet of Extra availability across Japan / India / Turkey / Israel.
4. **Settings / Data** — refresh datasets, see freshness, star popular games.

## 2. Architecture

Monorepo (`shared` / `server` / `web`):

- **React + Vite** SPA
- **Fastify** API on a single port (`0.0.0.0`)
- **SQLite** (`node:sqlite`) local cache
- Provider layer for PlayStation, gift cards, and exchange rates

```
Browser (LAN) → Fastify (:3000) → Services → SQLite
                              ↘ Providers → PlayStation / Eneba / Frankfurter
```

## 3. Data sources

| Dataset | Source | Notes |
|--------|--------|--------|
| Game search | `web.np.playstation.com` GraphQL persisted query `getSearchResults` | Hash in `PS_SEARCH_HASH` |
| Prices / editions | `store.playstation.com/{locale}/concept/{id}` SSR `__NEXT_DATA__` | Numeric prices in CTA cache |
| PS Plus Extra | `playstation.com/bin/imagic/gameslist?...&categoryList=plus-games-list` | Official JSON used by playstation.com |
| Gift cards | Eneba gift-card listing pages + manual entries | Enabled by config; see caveat below |
| FX | Frankfurter (ECB), fallback open.er-api.com | Base ILS |

See [docs/data-sources.md](docs/data-sources.md).

### Eneba ToS note

Eneba’s Terms forbid systematic automated retrieval without permission. This app includes an Eneba listing-page provider because you chose to enable it (and stated you have permission). Disable anytime with `GIFTCARD_ENEBA_ENABLED=false`. Prefer their affiliate product feed if you obtain access.

## 4. Installation

Requirements: **Node.js 22+** (24 recommended; uses built-in `node:sqlite`).

```bash
cd ps-price-compare
copy .env.example .env
npm install
```

## 5. Dependencies

Workspaces: `shared`, `server`, `web`. Key packages: Fastify, React 19, TanStack Query/Table/Virtual, Zod, Vite, Vitest.

## 6. How to start (home server)

```bash
npm run build
npm start
```

Server prints Local + LAN URLs, e.g. `http://192.168.1.50:3000`.

## 7. Development mode

```bash
npm run dev
```

- API: `http://127.0.0.1:3000`
- UI: Vite on `http://127.0.0.1:5173` (proxies `/api`, `--host` for LAN)

## 8. Production / local-home-server mode

`npm run build` then `npm start`. Static UI is served by Fastify from `web/dist`. Bind host defaults to `0.0.0.0`.

### Docker (Ubuntu / any Linux host)

Docker is not required on your Windows machine — build on the Ubuntu server (recommended) or export an image tarball.

**On the Ubuntu server** (after copying the project or cloning):

```bash
cp .env.example .env   # edit if needed
docker compose up -d --build
# open http://<server-ip>:3000
```

**Or build once and move a tarball:**

```bash
# build machine
docker build -t ps-price-compare:latest .
docker save ps-price-compare:latest | gzip > ps-price-compare.tar.gz

# Ubuntu server
docker load < ps-price-compare.tar.gz
docker run -d --name ps-price-compare -p 3000:3000 \
  --env-file .env -v ps-price-data:/app/data \
  --restart unless-stopped ps-price-compare:latest
```

SQLite persists in the `ps-price-data` volume (`DB_PATH=/app/data/ps-price-compare.sqlite`).

## 9. Find your computer’s LAN IP

```bash
npm run lan-ip
```

Or Windows: `ipconfig` → IPv4 of Wi-Fi/Ethernet.

## 10. Access from other devices

On the same Wi-Fi/LAN open `http://<LAN-IP>:3000` (or `:5173` in dev).

## 11. Windows Firewall (private networks only)

Run **as Administrator** only if needed:

```powershell
New-NetFirewallRule -DisplayName "PS Price Compare" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

Do **not** enable port forwarding / UPnP / public profile exposure.

## 12. Database location

Default: `./data/ps-price-compare.sqlite` (override with `DB_PATH`).

## 13. Data caching

SQLite stores games, prices, catalog, gift cards, rates. Failed refreshes update attempt timestamps only — **they do not wipe last good data**.

## 14. Refresh behavior

Settings page buttons call `POST /api/refresh/:dataset`. Minimum interval: `REFRESH_MIN_INTERVAL_SECONDS` (default 300). Game prices also refresh on-demand when you compare a title.

## 15. Gift-card providers

- `eneba` — listing pages for japan/india/turkey (`GIFTCARD_ENEBA_ENABLED`)
- `manual` — Settings/Gift Cards form for observed prices

See [docs/adding-a-seller.md](docs/adding-a-seller.md).

## 16. PlayStation data providers

`PlayStationStoreWebProvider` + `PsPlusGamesListProvider`. Replace without rewriting UI — see [docs/replacing-a-provider.md](docs/replacing-a-provider.md).

If search breaks with persisted-query errors: open store.playstation.com search, DevTools → Network → GraphQL `getSearchResults` → copy `sha256Hash` into `PS_SEARCH_HASH`.

## 17. Currency conversion

Rates are **units of foreign currency per 1 ILS**. Display always shows native price beside ₪. Cached rates are labelled when live fetch fails.

## 18. Known limitations

- Undocumented Sony endpoints may change (parsers are zod/structure based; fixtures in tests).
- Public non-member store prices only.
- Eneba listing pages expose the **cheapest** merchant per denomination visible in the SSR payload (not every paginated offer); geo-priced (often ILS).
- ECB rates are daily mid-market reference rates — not your card issuer’s rate.
- Popular Games = starred concept IDs (+ optional `popular_concepts` table). **No invented popularity scores.**

## 19. Add another region

See [docs/adding-a-region.md](docs/adding-a-region.md).

## 20. Add another gift-card seller

See [docs/adding-a-seller.md](docs/adding-a-seller.md).

## 21. Replace a data provider

See [docs/replacing-a-provider.md](docs/replacing-a-provider.md).

## Tests

```bash
npm test
```

Mock/fixture data is **test-only** and never shown as live UI data.

## License

Personal / private use.
