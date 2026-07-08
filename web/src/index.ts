import { loadConfig } from "./config.js";
import { buildAppFromEnv } from "./app.js";

const config = loadConfig();
const app = buildAppFromEnv();

app.listen(config.port, () => {
  console.log(`web backend listening on :${config.port}`);
});
