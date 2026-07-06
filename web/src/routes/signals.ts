import { Router, type Request } from "express";
import type { AppDeps } from "../server.js";
import type { SignalResult } from "../signalCache.js";
import { ApiError, asyncHandler } from "../errors.js";

// Client-facing message for upstream failures. The real provider error (which
// may embed the request path and a raw response-body snippet) is logged
// server-side but never returned to API clients.
const UPSTREAM_UNAVAILABLE_MESSAGE =
  "Upstream market data provider is currently unavailable";

function sanitizeResult(result: SignalResult, interval: string): SignalResult {
  if (result.status === "error") {
    console.error(
      `upstream error for ${result.pair} @ ${interval}: ${result.message}`,
    );
    return { pair: result.pair, status: "error", message: UPSTREAM_UNAVAILABLE_MESSAGE };
  }
  return result;
}

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
      res.json({ interval, results: results.map((r) => sanitizeResult(r, interval)) });
    }),
  );

  r.get(
    "/signals/:pair",
    asyncHandler(async (req, res) => {
      const interval = resolveInterval(deps, req);
      const pair = req.params.pair!;
      const result = await deps.cache.getSignal(pair, interval);
      if (result.status === "insufficient_data") {
        throw new ApiError("insufficient_data", 422, `insufficient candle data for ${pair}`);
      }
      if (result.status === "error") {
        console.error(`upstream error for ${pair} @ ${interval}: ${result.message}`);
        throw new ApiError("upstream_unavailable", 502, UPSTREAM_UNAVAILABLE_MESSAGE);
      }
      res.json(result);
    }),
  );

  return r;
}
