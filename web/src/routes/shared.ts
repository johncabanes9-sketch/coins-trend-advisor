import type { Request } from "express";
import type { AssetClass } from "@coins-trend-advisor/core";
import type { AppDeps } from "../server.js";
import { ApiError } from "../errors.js";

export const ASSET_CLASSES: AssetClass[] = ["crypto", "stock"];

export const UPSTREAM_UNAVAILABLE_MESSAGE =
  "Upstream market data provider is currently unavailable";

export function parseAssetClass(raw: string | undefined): AssetClass {
  if (raw !== undefined && ASSET_CLASSES.includes(raw as AssetClass)) {
    return raw as AssetClass;
  }
  throw new ApiError(
    "invalid_asset_class",
    400,
    `asset class must be one of ${ASSET_CLASSES.join(", ")}`,
  );
}

export function resolveInterval(deps: AppDeps, assetClass: AssetClass, req: Request): string {
  const provider = deps.registry.resolve(assetClass);
  if (!provider) {
    throw new ApiError("stocks_disabled", 503, "Stock data is not configured");
  }
  const configDefault =
    assetClass === "stock" ? deps.config.stockInterval : deps.config.cryptoInterval;
  const raw = req.query.interval;
  const interval =
    raw === undefined ? configDefault : typeof raw === "string" ? raw : "";
  if (!provider.allowedIntervals.includes(interval)) {
    throw new ApiError(
      "invalid_interval",
      400,
      `interval must be one of ${provider.allowedIntervals.join(", ")}`,
    );
  }
  return interval;
}
