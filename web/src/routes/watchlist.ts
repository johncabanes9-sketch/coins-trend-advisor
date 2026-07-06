import { Router } from "express";
import type { AppDeps } from "../server.js";
import { asyncHandler } from "../errors.js";

const PAIRS_TTL_MS = 3_600_000; // 1 hour

export function metaRoutes(deps: AppDeps): Router {
  const r = Router();

  r.get("/watchlist", (_req, res) => {
    res.json({ pairs: deps.config.watchlist });
  });

  // Per-app cache: pairs rarely change, so avoid hitting upstream on every call.
  let pairsCache: { pairs: string[]; at: number } | null = null;
  r.get(
    "/pairs",
    asyncHandler(async (_req, res) => {
      if (!pairsCache || Date.now() - pairsCache.at > PAIRS_TTL_MS) {
        pairsCache = { pairs: await deps.client.getPairs(), at: Date.now() };
      }
      res.json({ pairs: pairsCache.pairs });
    }),
  );

  return r;
}
