import { Router } from "express";
import { calculateProfit } from "@coins-trend-advisor/core";
import { ApiError } from "../errors.js";

export function profitRoutes(): Router {
  const r = Router();
  r.post("/profit", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { entryPrice, positionSize, targetPrice, feePct } = body;
    for (const [key, value] of Object.entries({
      entryPrice,
      positionSize,
      targetPrice,
      feePct,
    })) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ApiError("invalid_input", 400, `${key} must be a finite number`);
      }
    }
    try {
      const result = calculateProfit({
        entryPrice: entryPrice as number,
        positionSize: positionSize as number,
        targetPrice: targetPrice as number,
        feePct: feePct as number,
      });
      res.json(result);
    } catch (err) {
      throw new ApiError("invalid_input", 400, (err as Error).message);
    }
  });
  return r;
}
