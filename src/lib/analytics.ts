export type AnalyticsEventName =
  | "landing_primary_cta_clicked"
  | "auth_opened"
  | "auth_completed"
  | "library_opened"
  | "video_play_attempted"
  | "video_paywall_viewed"
  | "subscription_plans_viewed"
  | "plan_selected"
  | "checkout_started"
  | "dashboard_subscription_popup_viewed"
  | "dashboard_subscription_popup_closed"
  | "add_video_attempted"
  | "profile_menu_opened";

export type AnalyticsProperties = Record<string, string | boolean | number | null | undefined>;

export interface AnalyticsAdapter {
  track(name: AnalyticsEventName, properties?: AnalyticsProperties): void;
}

const noOpAnalytics: AnalyticsAdapter = { track: () => undefined };
let adapter = noOpAnalytics;

export function trackEvent(name: AnalyticsEventName, properties: AnalyticsProperties = {}): void {
  // Never pass titles, transcript text, URLs, emails, or other private data.
  adapter.track(name, properties);
}

export function setAnalyticsAdapter(next: AnalyticsAdapter | null): void {
  adapter = next || noOpAnalytics;
}
