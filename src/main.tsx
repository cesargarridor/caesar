import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { AccountProvider } from "./lib/account";
import { initTheme } from "./lib/themes";
import { applyFonts, getCatAnim, loadFonts } from "./lib/prefs";
import { getLang } from "./lib/i18n";
import { applyFontFamily, loadFontId } from "./lib/fonts";

document.documentElement.lang = getLang();
document.documentElement.toggleAttribute("data-cat-static", !getCatAnim());
initTheme();
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
