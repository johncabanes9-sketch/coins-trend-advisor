import { Router } from "express";

export function healthRoutes(): Router {
  const r = Router();
  const startedAt = Date.now();
  r.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: (Date.now() - startedAt) / 1000 });
  });
  return r;
}
