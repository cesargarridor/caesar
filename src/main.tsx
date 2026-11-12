import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { AccountProvider } from "./lib/account";
import { applyTheme, loadThemeId } from "./lib/themes";
import { applyFonts, getCatAnim, loadFonts } from "./lib/prefs";
import { getLang } from "./lib/i18n";
import { applyFontFamily, loadFontId } from "./lib/fonts";

document.documentElement.lang = getLang();
document.documentElement.toggleAttribute("data-cat-static", !getCatAnim());
applyTheme(loadThemeId());
applyFonts(loadFonts());
applyFontFamily(loadFontId());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <AccountProvider>
        <App />
      </AccountProvider>
    </ToastProvider>
  </StrictMode>,
);
