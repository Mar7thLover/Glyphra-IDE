import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";

import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./app/App";
import "./app/i18n";
import AppContextMenu from "./components/AppContextMenu";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles/global.css";

// Multi-window routing: the standalone Agents window shares this bundle and
// branches on its Tauri window label (lazy so the IDE shell stays lean).
const AgentWindowApp = React.lazy(() => import("./windows/AgentWindowApp"));
const isAgentWindow = getCurrentWindow().label === "agent";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppContextMenu />
      {isAgentWindow ? <Suspense fallback={null}><AgentWindowApp /></Suspense> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);
