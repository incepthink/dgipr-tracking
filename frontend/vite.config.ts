import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const backend = process.env.DGIPR_BACKEND ?? "http://127.0.0.1:8000";
// Paths served by FastAPI (JSON API, PDF/CSV downloads, fonts) are proxied in dev.
const proxied = ["/api", "/reports", "/report/preview.pdf", "/fonts"];

export default defineConfig({
  // FastAPI serves the SPA at /app/; the Vercel build for dgipr.hashcase.tech sets VITE_BASE=/tracking/.
  base: process.env.VITE_BASE ?? "/app/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { port: 5173, proxy: Object.fromEntries(proxied.map((p) => [p, { target: backend, changeOrigin: false }])) },
  build: { outDir: "../app/web/spa", emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
