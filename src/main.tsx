import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyTheme, loadThemeId } from "./lib/themes";
import { applyFonts, loadFonts } from "./lib/prefs";

applyTheme(loadThemeId());
applyFonts(loadFonts());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
