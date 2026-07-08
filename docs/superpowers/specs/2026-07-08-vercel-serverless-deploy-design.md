# Vercel Deploy: Static Frontend + Serverless Backend

**Date:** 2026-07-08
**Status:** Approved (design)

## Goal

Deploy `coins-trend-advisor` to Vercel entirely on free tiers:

- The Vite/React **frontend** is served as static assets from Vercel's CDN.
- The Express **backend** runs as a single catch-all Vercel Serverless Function under `/api/*`.
- Market-data caching moves to a **shared Upstash Redis** store so it survives the
  ephemeral serverless lifecycle.
- The API is protected by an **embedded bearer token** (casual-abuse deterrence).

Everything must run within free tiers. No architecture element requires a paid plan.

## Non-Goals

- Real per-user authentication / login. The embedded token is deliberately not a
  true secret (see Auth section).
- Serving the frontend from the Express function. On Vercel the CDN serves static
  assets; the function only handles `/api/*`.
- Commercial use. Vercel Hobby is personal/non-commercial only; that is accepted.

## Free-Tier Budget

| Component | Free-tier limit | Assessment |
| --- | --- | --- |
| Vercel Hobby | 100 GB bandwidth, 100K invocations, 100 GB-hrs, 100 builds/mo, **10s function timeout** | Ample for a personal dashboard |
| Upstash Redis | 256 MB, 500K commands/month, no card | Tiny usage with 5-min TTL |
| Coins.ph API | Public market data, free | Fine |
| Finnhub (stocks only) | 60 calls/min, free | Cache keeps us under |

Constraints accepted: (1) Vercel Hobby is non-commercial; (2) 10s function timeout —
routes make a few parallel upstream fetches + math, comfortably under budget.

## Architecture

```
Browser
  |
  |  GET /            -> Vercel CDN (frontend/dist static assets)
  |  GET/POST /api/*  -> Vercel Serverless Function (api/[...path].ts)
  v
api/[...path].ts
  - builds config + services + Express app at MODULE SCOPE (once per cold start)
  - exports the Express app as the handler (@vercel/node runs Express directly)
  - KlineCache backed by RedisKlineStore (Upstash) in production
  |
  v
Coins.ph / Finnhub upstreams (via existing providers)
```

The frontend already calls the API with relative `/api/...` paths (`frontend/src/api.ts`),
so same-origin hosting on Vercel means **no fetch-URL changes** are needed.

## Components

### 1. `vercel.json` (repo root)

- **Build command:** `npm run build -w core && npm run build -w frontend`
  (`core` must be built so the function can resolve `@coins-trend-advisor/core` -> `dist`).
- **Output directory:** `frontend/dist`.
- **Rewrites / routing:**
  - `/api/(.*)` -> the serverless function.
  - Everything else -> static assets with SPA fallback to `/index.html`.
- Node.js runtime pinned to a version @vercel/node supports (e.g. Node 20).

### 2. `api/[...path].ts` (serverless entry)

- A single catch-all function (NOT one function per route). Reuses the existing
  `createApp(deps)` from `web/src/server.ts` unchanged.
- Build order at module scope (runs once per cold start, reused by warm invocations):
  `loadConfig()` -> `buildRegistry()` -> `KlineCache` (with store from factory) ->
  services -> `createApp()`.
- Exports the Express `app` as the default handler.
- The function's filesystem has no `frontend/dist`, so `createApp`'s
  `existsSync(staticDir)` check is false -> it runs in pure-API mode automatically.
  No change to `server.ts` static-serving logic is required.
- In-flight request de-duplication in `KlineCache` remains in-memory per instance
  (harmless; at worst a duplicate upstream fetch across two cold instances).

### 3. Shared cache — `KlineStore` abstraction (the main code change)

Extract storage out of `KlineCache` behind a small interface so the cache logic
(freshness, stale-on-error, in-flight de-dup) stays untouched while the backing
store becomes swappable.

**Interface:**

```ts
interface StoredKlines { klines: Kline[]; computedAt: number; }

interface KlineStore {
  get(key: string): Promise<StoredKlines | null>;
  set(key: string, value: StoredKlines): Promise<void>;
}
```

**`MemoryKlineStore`** — wraps the current `Map` plus overflow eviction
(`maxEntries`, default 1000). Default for dev and tests; preserves today's behavior
exactly. Note: its `get`/`set` are synchronous internally but satisfy the async
interface trivially.

**`RedisKlineStore`** — uses `@upstash/redis` (REST client; ideal for serverless,
no TCP pooling). Stores each entry as JSON `{ klines, computedAt }` under the same
`assetClass:symbol:interval` key, with a **long safety TTL (e.g. 24h)** purely as a
garbage-collection backstop.

**Critical invariant:** freshness and stale-on-error are still computed IN CODE from
`computedAt` vs `ttlMs`, exactly as today. The Redis TTL is NOT the freshness gate.
This preserves the existing behavior where an upstream error falls back to a stale
cached copy with `staleAsOf`.

**`KlineCache` refactor:** replace the internal `Map` with a `KlineStore` dependency.
`getKlines`:
1. `store.get(key)` -> if present and `clock() - computedAt < ttlMs` -> fresh hit.
2. Else de-dup in-flight and `recompute`.
3. `recompute`: fetch from provider, `store.set(key, { klines, computedAt: now })`.
   On error, `store.get(key)` -> if a (possibly-expired) entry exists, return it as
   `stale`.

**Store selection (factory):** if `UPSTASH_REDIS_REST_URL` env is set ->
`RedisKlineStore`, else `MemoryKlineStore`. Used by both `web/src/index.ts`
(local dev) and `api/[...path].ts` (Vercel).

### 4. Auth — embedded bearer token

- Backend: set `API_TOKEN` env on Vercel -> the existing `requireToken` middleware
  in `server.ts` activates. No backend code change.
- Frontend: read `VITE_API_TOKEN` at build time and call the existing
  `setApiToken()` (`frontend/src/api.ts`) on startup so every request carries the
  `Authorization: Bearer <token>` header.
- **Known and accepted limitation:** because the token ships inside the public client
  bundle, it is discoverable by anyone who reads the JS. It deters casual bots and
  scanners hitting `/api` directly (~99% of junk traffic) but is not a true secret.
  Real cost protection is the shared cache, which bounds upstream calls regardless of
  caller. Documented explicitly so no one mistakes this for real authentication.

### 5. Environment variables (set on Vercel; login/link/env steps are interactive)

| Var | Purpose |
| --- | --- |
| `API_TOKEN` | Activates backend token check |
| `VITE_API_TOKEN` | Same value; embedded in frontend so it can authenticate |
| `UPSTASH_REDIS_REST_URL` | Selects + connects Redis store |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash auth |
| `FINNHUB_API_KEY` | Optional; only if stock asset class is used |

`vercel login`, `vercel link`, and `vercel env add` are interactive and will be run
by the user (documented as manual deploy steps, not automated here).

## Data Flow (unchanged from today except the store)

Frontend `request()` -> `/api/...` (relative) -> Vercel routes to function ->
Express route -> service -> `KlineCache.getKlines` -> `KlineStore` (Redis in prod)
-> provider on miss -> upstream. Response shape and error envelope
(`{ error: { code, message } }`) are unchanged.

## Error Handling

- Existing `errorMiddleware` and per-route error envelopes are unchanged.
- Redis unavailable / throws: `RedisKlineStore` failures are treated as a cache miss
  (log + proceed to upstream), so a Redis outage degrades to "no cache," never a hard
  failure. `set` failures are swallowed (best-effort write).
- Upstream failure with a cached entry still returns `stale` as today.

## Testing

- **`MemoryKlineStore`** unit tests: get/set round-trip, overflow eviction at
  `maxEntries`.
- **`RedisKlineStore`** unit tests: against a mocked `@upstash/redis` client —
  JSON serialization round-trip, get-miss returns `null`, get/set call the right
  client methods with TTL, and a throwing client is handled (miss for `get`,
  swallowed for `set`).
- **`KlineCache`** tests: updated to inject `MemoryKlineStore`; all existing
  behavior (freshness TTL, stale-on-error, in-flight de-dup, eviction) preserved.
- **Store factory** test: env present -> Redis; absent -> Memory.
- **Serverless entry** test: `api/[...path].ts` builds an app in pure-API mode
  (no static dir) and the exported handler responds to `/api/health`.
- Full Vercel behavior (routing, static + function together) verified via
  `vercel dev` and/or a preview deployment — a manual step, noted in deploy docs.

## Deployment Steps (manual, user-run)

1. `vercel login` (interactive).
2. Create a free Upstash Redis DB; copy REST URL + token.
3. `vercel link` to the project.
4. Add env vars (`vercel env add ...` or dashboard) for Production + Preview.
5. `vercel --prod` (or connect the GitHub repo for auto-deploy on push).

## Risks / Open Items

- 10s function timeout: watch analyze/forecast latency on cold start; unlikely to
  breach but noted.
- `@vercel/node` must correctly bundle the workspace import
  `@coins-trend-advisor/core`; mitigated by building `core` in the build command so
  `dist` exists for resolution. Verified via `vercel dev` before relying on prod.
