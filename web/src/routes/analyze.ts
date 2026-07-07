import { Router } from "express";
import type { AccountState, AssetClass } from "@coins-trend-advisor/core";
import type { AppDeps } from "../server.js";
import { ApiError, asyncHandler } from "../errors.js";
import { parseAssetClass } from "./shared.js";

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError("invalid_input", 400, `${name} must be a finite number`);
  }
  return value;
}

function parseAccount(body: Record<string, unknown>): AccountState {
  const equity = finite(body.equity, "equity");

  let position: AccountState["position"] = null;
  if (body.position !== null && body.position !== undefined) {
    const p = body.position as Record<string, unknown>;
    position = {
      size: finite(p.size, "position.size"),
      entryPrice: finite(p.entryPrice, "position.entryPrice"),
    };
  }

  const l = (body.lossToDate ?? {}) as Record<string, unknown>;
  const lossToDate = {
    dayPct: finite(l.dayPct, "lossToDate.dayPct"),
    weekPct: finite(l.weekPct, "lossToDate.weekPct"),
  };

  let marketStatus: AccountState["marketStatus"];
  if (body.marketStatus !== undefined) {
    if (body.marketStatus !== "open" && body.marketStatus !== "closed") {
      throw new ApiError("invalid_input", 400, "marketStatus must be 'open' or 'closed'");
    }
    marketStatus = body.marketStatus;
  }

  return { equity, position, lossToDate, marketStatus };
}

export function analyzeRoutes(deps: AppDeps): Router {
  const r = Router();
  r.post(
    "/analyze/:assetClass",
    asyncHandler(async (req, res) => {
      const assetClass: AssetClass = parseAssetClass(req.params.assetClass);

      // Surface configuration errors as clean 4xx/503 (matching the signals and
      // forecast routes) instead of letting them collapse into a fetch failure
      // that the service reports as a HOLD.
      const provider = deps.registry.resolve(assetClass);
      if (!provider) {
        throw new ApiError("stocks_disabled", 503, "Stock data is not configured");
      }

      const body = (req.body ?? {}) as Record<string, unknown>;

      if (typeof body.symbol !== "string" || body.symbol.trim() === "") {
        throw new ApiError("invalid_input", 400, "symbol must be a non-empty string");
      }
      const configDefault =
        assetClass === "stock" ? deps.config.stockInterval : deps.config.cryptoInterval;
      const interval =
        body.interval === undefined
          ? configDefault
          : typeof body.interval === "string" && body.interval.trim() !== ""
            ? body.interval
            : (() => {
                throw new ApiError("invalid_input", 400, "interval must be a non-empty string");
              })();
      if (!provider.allowedIntervals.includes(interval)) {
        throw new ApiError(
          "invalid_interval",
          400,
          `interval must be one of ${provider.allowedIntervals.join(", ")}`,
        );
      }

      const account = parseAccount(body);
      const signal = await deps.analyze.analyze(assetClass, body.symbol, interval, account);
      res.json(signal);
    }),
  );
  return r;
}
