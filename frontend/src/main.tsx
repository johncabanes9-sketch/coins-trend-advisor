import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initApiToken } from "./api.js";
import "./styles.css";

initApiToken(import.meta.env);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
