import { buildAppFromEnv } from "../web/src/app.js";

// Built once per cold start at module scope; reused across warm invocations.
const app = buildAppFromEnv();

export default app;
