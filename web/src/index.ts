import { loadConfig } from "./config.js";
import { buildRegistry } from "./providers.js";
import { KlineCache } from "./klineCache.js";
import { SignalService } from "./signalService.js";
import { ForecastService } from "./forecastService.js";
import { createApp } from "./server.js";

const config = loadConfig();
const registry = buildRegistry(config);
const cache = new KlineCache({
  resolveProvider: (ac) => {
    const p = registry.resolve(ac);
    if (!p) throw new Error(`no provider for asset class ${ac}`);
    return p;
  },
  ttlMs: config.signalTtlMs,
  klineLimit: config.klineLimit,
});
const signals = new SignalService({ cache });
const forecasts = new ForecastService({ cache });
const app = createApp({ config, registry, cache, signals, forecasts });

app.listen(config.port, () => {
  console.log(`web backend listening on :${config.port}`);
});
