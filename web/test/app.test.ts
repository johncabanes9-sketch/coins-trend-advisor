import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildAppFromEnv } from "../src/app.js";

describe("buildAppFromEnv", () => {
  it("serves /api/health in pure-API mode without env config", async () => {
    const app = buildAppFromEnv({} as NodeJS.ProcessEnv);
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rejects protected routes with 401 when API_TOKEN is set and no token is sent", async () => {
    const app = buildAppFromEnv({ API_TOKEN: "secret" } as unknown as NodeJS.ProcessEnv);
    const res = await request(app).get("/api/watchlist");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });
});
