import { loadConfig } from "./config.js";
import { makeClient } from "./coins.js";
import { SignalCache } from "./signalCache.js";
import { createApp } from "./server.js";

const config = loadConfig();
const client = makeClient(config);
const cache = new SignalCache({
  client,
  ttlMs: config.signalTtlMs,
  klineLimit: config.klineLimit,
});
const app = createApp({ config, client, cache });

app.listen(config.port, () => {
  console.log(`web backend listening on :${config.port}`);
});
