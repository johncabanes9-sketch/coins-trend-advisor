import type { Express } from "express";
import type { AssetClass } from "@coins-trend-advisor/core";
import { loadConfig } from "./config.js";
import { buildRegistry } from "./providers.js";
import { makeKlineStore } from "./klineStore.js";
import { KlineCache } from "./klineCache.js";
import { SignalService } from "./signalService.js";
import { ForecastService } from "./forecastService.js";
import { AnalyzeService } from "./analyzeService.js";
import { createApp } from "./server.js";

/** Build the fully-wired Express app from environment configuration. Shared by
 * the local server (index.ts) and the Vercel serverless entry (api/[...path].ts). */
export function buildAppFromEnv(env: NodeJS.ProcessEnv = process.env): Express {
  const config = loadConfig(env);
  const registry = buildRegistry(config);
  const store = makeKlineStore(env);
  const cache = new KlineCache({
    resolveProvider: (ac: AssetClass) => {
      const p = registry.resolve(ac);
      if (!p) throw new Error(`no provider for asset class ${ac}`);
      return p;
    },
    ttlMs: config.signalTtlMs,
    klineLimit: config.klineLimit,
    store,
  });
  const signals = new SignalService({ cache });
  const forecasts = new ForecastService({ cache });
  const analyze = new AnalyzeService({ cache, risk: config.risk });
  return createApp({ config, registry, cache, signals, forecasts, analyze });
}
