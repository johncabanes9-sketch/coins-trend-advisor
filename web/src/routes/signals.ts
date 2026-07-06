import { Router, type Request } from "express";
import type { AppDeps } from "../server.js";
import { ApiError, asyncHandler } from "../errors.js";

function resolveInterval(deps: AppDeps, req: Request): string {
  const raw = req.query.interval;
  // Absent -> default. Present but not a plain string (e.g. duplicate query
  // params parsed as an array) is malformed input, not the default.
  const interval =
    raw === undefined ? deps.config.klineInterval : typeof raw === "string" ? raw : "";
  if (!deps.config.allowedIntervals.includes(interval)) {
    throw new ApiError(
      "invalid_interval",
      400,
      `interval must be one of ${deps.config.allowedIntervals.join(", ")}`,
    );
  }
  return interval;
}

export function signalRoutes(deps: AppDeps): Router {
  const r = Router();

  r.get(
    "/signals",
    asyncHandler(async (req, res) => {
      const interval = resolveInterval(deps, req);
      const results = await deps.cache.getWatchlistSignals(deps.config.watchlist, interval);
      res.json({ interval, results });
    }),
  );

  r.get(
    "/signals/:pair",
    asyncHandler(async (req, res) => {
      const interval = resolveInterval(deps, req);
      const pair = req.params.pair;
      const result = await deps.cache.getSignal(pair, interval);
      if (result.status === "insufficient_data") {
        throw new ApiError("insufficient_data", 422, `insufficient candle data for ${pair}`);
      }
      if (result.status === "error") {
        throw new ApiError("upstream_unavailable", 502, result.message);
      }
      res.json(result);
    }),
  );

  return r;
}
