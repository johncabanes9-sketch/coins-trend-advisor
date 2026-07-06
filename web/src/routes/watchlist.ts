import { Router } from "express";
import type { AssetClass } from "@coins-trend-advisor/core";
import type { AppDeps } from "../server.js";
import { ApiError, asyncHandler } from "../errors.js";

const ASSET_CLASSES: AssetClass[] = ["crypto", "stock"];
const PAIRS_TTL_MS = 3_600_000; // 1 hour

export function metaRoutes(deps: AppDeps): Router {
  const r = Router();

  r.get("/watchlist", (_req, res) => {
    res.json({ entries: deps.config.watchlist });
  });

  // Per-class symbol cache: symbol lists rarely change.
  const pairsCache = new Map<AssetClass, { symbols: string[]; at: number }>();
  r.get(
    "/pairs/:assetClass",
    asyncHandler(async (req, res) => {
      const raw = req.params.assetClass;
      if (raw === undefined || !ASSET_CLASSES.includes(raw as AssetClass)) {
        throw new ApiError("invalid_asset_class", 400, `asset class must be one of ${ASSET_CLASSES.join(", ")}`);
      }
      const assetClass = raw as AssetClass;
      const provider = deps.registry.resolve(assetClass);
      if (!provider) {
        throw new ApiError("stocks_disabled", 503, "Stock data is not configured");
      }
      const hit = pairsCache.get(assetClass);
      if (!hit || Date.now() - hit.at > PAIRS_TTL_MS) {
        pairsCache.set(assetClass, { symbols: await provider.listSymbols(), at: Date.now() });
      }
      res.json({ assetClass, symbols: pairsCache.get(assetClass)!.symbols });
    }),
  );

  return r;
}
