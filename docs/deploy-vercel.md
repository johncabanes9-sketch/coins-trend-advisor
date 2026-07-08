# Deploying to Vercel (free tier)

Frontend is served statically from Vercel's CDN; the Express backend runs as one
catch-all serverless function at `/api/*`. Market-data caching uses Upstash Redis
so the cache survives the serverless lifecycle.

## One-time setup

1. `npm i -g vercel` (already installed) and `vercel login`.
2. Create a free Upstash Redis database at https://console.upstash.com — copy the
   **REST URL** and **REST token** (not the TCP connection string).
3. From the repo root: `vercel link`.
4. Add environment variables for **Production** and **Preview**
   (`vercel env add <NAME>` or the Vercel dashboard):

   | Variable | Value |
   | --- | --- |
   | `API_TOKEN` | any random string (backend token check) |
   | `VITE_API_TOKEN` | the same string (embedded in the frontend build) |
   | `UPSTASH_REDIS_REST_URL` | from Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | from Upstash |
   | `FINNHUB_API_KEY` | optional; only if using the stock asset class |

   Note: `VITE_API_TOKEN` ships inside the public client bundle — it deters casual
   abuse but is not a true secret. The Upstash cache is what bounds upstream cost.

## Deploy

- Preview: `vercel`
- Production: `vercel --prod`
- Or connect the GitHub repo in the Vercel dashboard for auto-deploy on push.

## Verify

- `curl https://<your-app>.vercel.app/api/health` → `{"status":"ok",...}`
- Open the app; the dashboard should load market data (calls go through `/api/*`).
- Without env vars set, the backend still runs but uses in-memory caching and an
  open API (no token). Set the vars above for the intended production behavior.

## Free-tier notes

- Vercel Hobby: personal/non-commercial only; 10s function timeout, 100 GB
  bandwidth/mo, 100K invocations/mo.
- Upstash free: 256 MB, 500K commands/month.
