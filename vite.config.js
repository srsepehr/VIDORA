import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dashboardPreviewPlugin, isDashboardPreviewEnabled } from "./config/dashboard-preview.mjs";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const dashboardPreviewEnabled = isDashboardPreviewEnabled({
    command,
    mode,
    nodeEnv: process.env.NODE_ENV,
    flag: env.VIDORA_ENABLE_DASHBOARD_PREVIEW,
  });

  return {
    base: "./",
    define: {
      __VIDORA_DASHBOARD_PREVIEW_ENABLED__: JSON.stringify(dashboardPreviewEnabled),
    },
    plugins: [
      dashboardPreviewPlugin(dashboardPreviewEnabled),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
