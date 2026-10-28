import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies the API so the browser talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: { "/api": { target: process.env.CP_API_URL ?? "http://127.0.0.1:8081", changeOrigin: false } },
  },
});
