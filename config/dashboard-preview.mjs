export const DASHBOARD_PREVIEW_PATH = "/dev/dashboard-preview";

export function isDashboardPreviewEnabled({ command, mode, nodeEnv, flag }) {
  return command === "serve"
    && mode === "development"
    && nodeEnv === "development"
    && flag === "true";
}

export function isDashboardPreviewPath(url = "") {
  try {
    const pathname = new URL(url, "http://localhost").pathname.replace(/\/$/, "");
    return pathname === DASHBOARD_PREVIEW_PATH;
  } catch {
    return false;
  }
}

export function createDashboardPreviewGuard(enabled) {
  return (request, response, next) => {
    if (!isDashboardPreviewPath(request.url)) {
      next();
      return;
    }

    if (enabled) {
      next();
      return;
    }

    response.statusCode = 404;
    response.statusMessage = "Not Found";
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Not Found");
  };
}

export function dashboardPreviewPlugin(enabled) {
  const installGuard = (server) => {
    server.middlewares.use(createDashboardPreviewGuard(enabled));
  };

  return {
    name: "vidora-dashboard-preview-guard",
    configureServer: installGuard,
    configurePreviewServer: installGuard,
  };
}
