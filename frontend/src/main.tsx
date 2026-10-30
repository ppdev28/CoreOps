import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { resolveServerUrl } from "./lib/auth";

// Pick the home-network address before the first request if it is reachable.
void resolveServerUrl().finally(() =>
  ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
),
);
