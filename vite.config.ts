import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// El CSP estricto vive en index.html. Solo en `vite dev` se relaja lo mínimo
// (preámbulo inline de React Refresh + websocket HMR). El build de producción queda intacto.
const relaxCspInDev = (): Plugin => ({
  name: "relax-csp-in-dev",
  apply: "serve",
  transformIndexHtml(html) {
    return html
      .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self'", "connect-src 'self' ws://localhost:1420");
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), relaxCspInDev()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "localhost" },
  build: { target: "es2021", sourcemap: false },
});
