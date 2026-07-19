export const ROUTES = {
  home: "/",
  authLogin: "/login",
  authSignup: "/signup",
  library: "/library",
  subscriptions: "/subscriptions",
  checkout: "/checkout",
  admin: "/admin",
  dashboard: "/dashboard",
  addVideo: "/dashboard/new-translation",
  myVideos: "/dashboard/videos",
  saved: "/dashboard/saved",
  dashboardSubscription: "/dashboard/subscription",
  support: "/dashboard/support",
  settings: "/dashboard/settings",
} as const;

export function watchRoute(slug: string): string {
  return `/watch/${encodeURIComponent(slug)}`;
}

export function categoryRoute(slug: string): string {
  return `/library/category/${encodeURIComponent(slug)}`;
}

export function hashRoute(path: string): string {
  return `#${path}`;
}
