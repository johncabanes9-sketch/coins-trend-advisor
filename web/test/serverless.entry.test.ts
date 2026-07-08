import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../api/[...path].js";

describe("serverless entry", () => {
  it("default-exports an Express app that answers /api/health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
