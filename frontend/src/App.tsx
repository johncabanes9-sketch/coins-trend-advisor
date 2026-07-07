import { useEffect, useState } from "react";
import type { AssetClass } from "./types.js";
import { setApiToken } from "./api.js";
import { Controls, defaultInterval } from "./components/Controls.js";
import { Lookup } from "./components/Lookup.js";
import { Dashboard } from "./components/Dashboard.js";
import { SwingAnalyzer } from "./components/SwingAnalyzer.js";

const TOKEN_KEY = "cta.token";

export function App() {
  const [assetClass, setAssetClass] = useState<AssetClass>("crypto");
  const [interval, setIntervalValue] = useState<string>(defaultInterval("crypto"));
  const [horizon, setHorizon] = useState(5);
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) ?? "");

  useEffect(() => {
    setApiToken(token || null);
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }, [token]);

  function changeAssetClass(next: AssetClass) {
    setAssetClass(next);
    setIntervalValue(defaultInterval(next));
  }

  return (
    <main className="app">
      <header className="app-header">
        <div className="brand">
          <h1>Coins Trend Advisor</h1>
          <p className="tagline">Technical signals &amp; forecasts — not financial advice</p>
        </div>
        <Controls
          assetClass={assetClass}
          interval={interval}
          horizon={horizon}
          token={token}
          onAssetClass={changeAssetClass}
          onInterval={setIntervalValue}
          onHorizon={setHorizon}
          onToken={setToken}
        />
      </header>

      <section className="section">
        <h2 className="section-title">Look up a symbol</h2>
        <Lookup assetClass={assetClass} interval={interval} horizon={horizon} />
      </section>

      <section className="section">
        <h2 className="section-title">Swing analysis</h2>
        <SwingAnalyzer assetClass={assetClass} interval={interval} />
      </section>

      <section className="section">
        <h2 className="section-title">Watchlist</h2>
        <Dashboard assetClass={assetClass} interval={interval} horizon={horizon} />
      </section>
    </main>
  );
}
