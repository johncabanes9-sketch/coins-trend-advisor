import { Router } from "express";
import type { AppDeps } from "../server.js";
import type { SignalResult } from "../signalService.js";
import { ApiError, asyncHandler } from "../errors.js";
import {
  UPSTREAM_UNAVAILABLE_MESSAGE,
  parseAssetClass,
  resolveInterval,
} from "./shared.js";

function sanitizeResult(result: SignalResult, interval: string): SignalResult {
  if (result.status === "error") {
    console.error(
      `upstream error for ${result.assetClass}:${result.symbol} @ ${interval}: ${result.message}`,
    );
    return {
      assetClass: result.assetClass,
      symbol: result.symbol,
      status: "error",
      message: UPSTREAM_UNAVAILABLE_MESSAGE,
    };
  }
  return result;
}

export function signalRoutes(deps: AppDeps): Router {
  const r = Router();

  r.get(
    "/signals/:assetClass",
    asyncHandler(async (req, res) => {
      const assetClass = parseAssetClass(req.params.assetClass);
      const interval = resolveInterval(deps, assetClass, req);
      const entries = deps.config.watchlist.filter((e) => e.assetClass === assetClass);
      const results = await deps.signals.getMany(entries, interval);
      res.json({ assetClass, interval, results: results.map((x) => sanitizeResult(x, interval)) });
    }),
  );

  r.get(
    "/signals/:assetClass/:symbol",
    asyncHandler(async (req, res) => {
      const assetClass = parseAssetClass(req.params.assetClass);
      const interval = resolveInterval(deps, assetClass, req);
      const symbol = req.params.symbol!;
      const result = await deps.signals.get(assetClass, symbol, interval);
      if (result.status === "insufficient_data") {
        throw new ApiError("insufficient_data", 422, `insufficient candle data for ${symbol}`);
      }
      if (result.status === "error") {
        console.error(`upstream error for ${assetClass}:${symbol} @ ${interval}: ${result.message}`);
        throw new ApiError("upstream_unavailable", 502, UPSTREAM_UNAVAILABLE_MESSAGE);
      }
      res.json(result);
    }),
  );

  return r;
}
