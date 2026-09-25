import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Convenience proxy so the browser can reach a local backend without CORS.
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/comfy": {
        target: process.env.VITE_COMFY_URL ?? "http://127.0.0.1:8188",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/comfy/, ""),
      },
    },
  },
});
