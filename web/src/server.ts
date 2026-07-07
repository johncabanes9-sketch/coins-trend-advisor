import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./config.js";
import type { KlineCache } from "./klineCache.js";
import type { SignalService } from "./signalService.js";
import type { ForecastService } from "./forecastService.js";
import type { AnalyzeService } from "./analyzeService.js";
import type { ProviderRegistry } from "./providers.js";
import { errorMiddleware } from "./errors.js";
import { healthRoutes } from "./routes/health.js";
import { profitRoutes } from "./routes/profit.js";
import { signalRoutes } from "./routes/signals.js";
import { forecastRoutes } from "./routes/forecast.js";
import { metaRoutes } from "./routes/watchlist.js";
import { analyzeRoutes } from "./routes/analyze.js";

export interface AppDeps {
  config: AppConfig;
  registry: ProviderRegistry;
  cache: KlineCache;
  signals: SignalService;
  forecasts: ForecastService;
  analyze: AnalyzeService;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.use("/api", healthRoutes());

  if (deps.config.apiToken) {
    app.use("/api", requireToken(deps.config.apiToken));
  }

  app.use("/api", profitRoutes());
  app.use("/api", signalRoutes(deps));
  app.use("/api", forecastRoutes(deps));
  app.use("/api", metaRoutes(deps));
  app.use("/api", analyzeRoutes(deps));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found" } });
  });

  // Serve the built frontend when present. Absent (pure-API deploy) → skip.
  const staticDir = deps.config.staticDir;
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(join(staticDir, "index.html"));
    });
  }

  app.use(errorMiddleware);
  return app;
}

function requireToken(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (provided !== token) {
      res
        .status(401)
        .json({ error: { code: "unauthorized", message: "Invalid or missing API token" } });
      return;
    }
    next();
  };
}
