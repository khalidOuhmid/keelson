import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DEV_TOKEN = "keelson-dev-token";
const DEV_API = "http://127.0.0.1:5284";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5283,
    strictPort: true,
    proxy: {
      "/api": {
        target: DEV_API,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (request) => {
            request.setHeader("x-keelson-token", DEV_TOKEN);
          });
        },
      },
    },
  },
  preview: { port: 5283, strictPort: true },
});
