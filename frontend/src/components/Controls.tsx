import type { AssetClass } from "../types.js";

const INTERVALS: Record<AssetClass, string[]> = {
  crypto: ["1h", "4h", "1d"],
  stock: ["D", "W"],
};

export function intervalsFor(assetClass: AssetClass): string[] {
  return INTERVALS[assetClass];
}

export function defaultInterval(assetClass: AssetClass): string {
  const [first] = INTERVALS[assetClass];
  return first ?? "1h";
}

export function Controls({
  assetClass,
  interval,
  horizon,
  token,
  onAssetClass,
  onInterval,
  onHorizon,
  onToken,
}: {
  assetClass: AssetClass;
  interval: string;
  horizon: number;
  token: string;
  onAssetClass: (a: AssetClass) => void;
  onInterval: (i: string) => void;
  onHorizon: (n: number) => void;
  onToken: (t: string) => void;
}) {
  return (
    <div className="controls">
      <div className="seg" role="group" aria-label="Asset class">
        <button type="button" className="seg-btn" aria-pressed={assetClass === "crypto"} onClick={() => onAssetClass("crypto")}>
          Crypto
        </button>
        <button type="button" className="seg-btn" aria-pressed={assetClass === "stock"} onClick={() => onAssetClass("stock")}>
          Stocks
        </button>
      </div>

      <label className="field">
        <span>Interval</span>
        <select value={interval} onChange={(e) => onInterval(e.target.value)}>
          {intervalsFor(assetClass).map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Horizon</span>
        <input
          type="number" min={1} value={horizon}
          onChange={(e) => onHorizon(Number(e.target.value))}
        />
      </label>

      <label className="field field-token">
        <span>API token</span>
        <input
          type="text" value={token} placeholder="optional" autoComplete="off"
          onChange={(e) => onToken(e.target.value)}
        />
      </label>
    </div>
  );
}
