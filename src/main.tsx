import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyTheme, loadThemeId } from "./lib/themes";
import { applyFonts, getCatAnim, loadFonts } from "./lib/prefs";
import { getLang } from "./lib/i18n";

document.documentElement.lang = getLang();
document.documentElement.toggleAttribute("data-cat-static", !getCatAnim());
applyTheme(loadThemeId());
applyFonts(loadFonts());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
