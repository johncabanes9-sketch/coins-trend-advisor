import type {
  AccountState,
  ApiResult,
  AssetClass,
  ForecastItem,
  ProfitResult,
  SignalItem,
  SwingSignal,
  WatchlistEntry,
} from "./types.js";

let apiToken: string | null = null;
export function setApiToken(token: string | null): void {
  apiToken = token;
}

interface SignalsResponse { assetClass: AssetClass; interval: string; results: SignalItem[] }
interface ForecastsResponse { assetClass: AssetClass; interval: string; horizon: number; results: ForecastItem[] }
interface WatchlistResponse { entries: WatchlistEntry[] }
interface PairsResponse { assetClass: AssetClass; symbols: string[] }

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
    if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;
    const res = await fetch(url, { ...init, headers });
    const body = (await res.json()) as unknown;
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } }).error;
      return {
        ok: false,
        error: { code: err?.code ?? "http_error", message: err?.message ?? `HTTP ${res.status}` },
      };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: { code: "network_error", message: "Could not reach the server" } };
  }
}

export function getWatchlist(): Promise<ApiResult<WatchlistResponse>> {
  return request("/api/watchlist");
}

export function getSignals(assetClass: AssetClass, interval: string): Promise<ApiResult<SignalsResponse>> {
  return request(`/api/signals/${assetClass}?interval=${encodeURIComponent(interval)}`);
}

export function getForecasts(
  assetClass: AssetClass,
  interval: string,
  horizon: number,
): Promise<ApiResult<ForecastsResponse>> {
  return request(`/api/forecast/${assetClass}?interval=${encodeURIComponent(interval)}&horizon=${horizon}`);
}

export function getSignal(assetClass: AssetClass, symbol: string, interval: string): Promise<ApiResult<SignalItem>> {
  return request(`/api/signals/${assetClass}/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}`);
}

export function getForecast(
  assetClass: AssetClass,
  symbol: string,
  interval: string,
  horizon: number,
): Promise<ApiResult<ForecastItem>> {
  return request(
    `/api/forecast/${assetClass}/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&horizon=${horizon}`,
  );
}

export function getPairs(assetClass: AssetClass): Promise<ApiResult<PairsResponse>> {
  return request(`/api/pairs/${assetClass}`);
}

export function postProfit(body: {
  entryPrice: number;
  targetPrice: number;
  positionSize: number;
  feePct: number;
}): Promise<ApiResult<ProfitResult>> {
  return request("/api/profit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postAnalyze(
  assetClass: AssetClass,
  body: { symbol: string; interval: string; account: AccountState },
): Promise<ApiResult<SwingSignal>> {
  return request(`/api/analyze/${assetClass}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: body.symbol, interval: body.interval, ...body.account }),
  });
}
