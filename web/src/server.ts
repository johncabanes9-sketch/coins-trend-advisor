import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import type { AppConfig } from "./config.js";
import type { SignalCache } from "./signalCache.js";
import type { CoinsClient } from "@coins-trend-advisor/core";
import { errorMiddleware } from "./errors.js";
import { healthRoutes } from "./routes/health.js";
import { profitRoutes } from "./routes/profit.js";
import { signalRoutes } from "./routes/signals.js";

export interface AppDeps {
  config: AppConfig;
  client: CoinsClient;
  cache: SignalCache;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  // Health is intentionally mounted before auth so liveness checks stay open.
  app.use("/api", healthRoutes());

  if (deps.config.apiToken) {
    app.use("/api", requireToken(deps.config.apiToken));
  }

  app.use("/api", profitRoutes());
  app.use("/api", signalRoutes(deps));
  // --- feature routers are mounted here by later tasks ---

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found" } });
  });
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
