import { Router } from "express";
import type { AppDeps } from "../server.js";
import type { ForecastResult } from "../forecastService.js";
import { ApiError, asyncHandler } from "../errors.js";
import {
  UPSTREAM_UNAVAILABLE_MESSAGE,
  parseAssetClass,
  resolveInterval,
} from "./shared.js";

function parseHorizon(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string") {
    throw new ApiError("invalid_horizon", 400, "horizon must be a single positive integer");
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError("invalid_horizon", 400, "horizon must be a positive integer");
  }
  return n;
}

function sanitizeForecast(result: ForecastResult, interval: string): ForecastResult {
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

export function forecastRoutes(deps: AppDeps): Router {
  const r = Router();

  r.get(
    "/forecast/:assetClass",
    asyncHandler(async (req, res) => {
      const assetClass = parseAssetClass(req.params.assetClass);
      const interval = resolveInterval(deps, assetClass, req);
      const horizon = parseHorizon(req.query.horizon, deps.config.forecastHorizon);
      const entries = deps.config.watchlist.filter((e) => e.assetClass === assetClass);
      const results = await deps.forecasts.getMany(entries, interval, horizon);
      res.json({
        assetClass,
        interval,
        horizon,
        results: results.map((x) => sanitizeForecast(x, interval)),
      });
    }),
  );

  r.get(
    "/forecast/:assetClass/:symbol",
    asyncHandler(async (req, res) => {
      const assetClass = parseAssetClass(req.params.assetClass);
      const interval = resolveInterval(deps, assetClass, req);
      const symbol = req.params.symbol!;
      const horizon = parseHorizon(req.query.horizon, deps.config.forecastHorizon);
      const result = await deps.forecasts.get(assetClass, symbol, interval, horizon);
      if (result.status === "insufficient_data") {
        throw new ApiError("insufficient_data", 422, `insufficient candle data for ${symbol}`);
      }
      if (result.status === "error") {
        console.error(`upstream error for ${assetClass}:${symbol} @ ${interval}: ${result.message}`);
        throw new ApiError("upstream_unavailable", 502, UPSTREAM_UNAVAILABLE_MESSAGE);
      }
      // Echo the resolved interval so `horizon` (a step count) is interpretable.
      res.json({ ...result, interval });
    }),
  );

  return r;
}
