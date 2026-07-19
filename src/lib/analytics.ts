import { getCachedSession } from "./auth";
import { getBrowserEnv } from "./env";

export type AnalyticsEventName =
  | "user_signed_up"
  | "user_logged_in"
  | "landing_viewed"
  | "library_viewed"
  | "category_viewed"
  | "video_card_clicked"
  | "video_detail_viewed"
  | "video_started"
  | "video_paused"
  | "video_resumed"
  | "video_progress"
  | "video_completed"
  | "subtitle_enabled"
  | "subtitle_disabled"
  | "summary_opened"
  | "key_takeaway_interacted"
  | "watchlist_added"
  | "watchlist_removed"
  | "video_liked"
  | "video_unliked"
  | "upload_page_viewed"
  | "video_upload_started"
  | "video_upload_completed"
  | "youtube_link_submitted"
  | "translation_requested"
  | "translation_completed"
  | "translation_failed"
  | "pricing_viewed"
  | "payment_succeeded"
  | "payment_failed"
  | "subscription_expired"
  | "video_chat_opened"
  | "video_chat_message_sent"
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

const ANONYMOUS_ID_KEY = "vidora.analytics.anonymous-id.v1";
const SESSION_ID_KEY = "vidora.analytics.session-id.v1";

function stableId(storage: Storage, key: string): string {
  const current = storage.getItem(key);
  if (current && /^[0-9a-f-]{36}$/i.test(current)) return current;
  const next = crypto.randomUUID();
  storage.setItem(key, next);
  return next;
}

function deviceClass(): "mobile" | "tablet" | "desktop" | "unknown" {
  const width = window.innerWidth;
  if (!Number.isFinite(width)) return "unknown";
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

function browserFamily(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

function sanitizeProperties(properties: AnalyticsProperties): AnalyticsProperties {
  const blocked = /email|phone|password|token|secret|transcript|question|answer|title|url/i;
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => !blocked.test(key) && (["string", "number", "boolean"].includes(typeof value) || value === null)),
  );
}

export function createSupabaseAnalyticsAdapter(): AnalyticsAdapter {
  const env = getBrowserEnv();
  const anonymousId = stableId(window.localStorage, ANONYMOUS_ID_KEY);
  const sessionId = stableId(window.sessionStorage, SESSION_ID_KEY);
  return {
    track(name, properties = {}) {
      const session = getCachedSession();
      const body = {
        p_event_id: crypto.randomUUID(),
        p_event_name: name,
        p_occurred_at: new Date().toISOString(),
        p_anonymous_id: anonymousId,
        p_session_id: sessionId,
        p_page: `${window.location.pathname}${window.location.hash}`.slice(0, 300),
        p_referrer: document.referrer ? new URL(document.referrer).origin : null,
        p_device_class: deviceClass(),
        p_browser_family: browserFamily(),
        p_properties: sanitizeProperties(properties),
      };
      void fetch(`${env.supabaseUrl}/rest/v1/rpc/record_product_event`, {
        method: "POST",
        keepalive: true,
        headers: {
          apikey: env.supabaseAnonKey,
          Authorization: `Bearer ${session?.accessToken || env.supabaseAnonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }).catch(() => undefined);
    },
  };
}

export function initializeAnalytics(): void {
  try {
    setAnalyticsAdapter(createSupabaseAnalyticsAdapter());
  } catch {
    setAnalyticsAdapter(null);
  }
}

export interface PlaybackEventProperties extends AnalyticsProperties {
  video_id: string;
  playback_session_id: string;
  position_seconds: number;
  duration_seconds: number;
  watched_seconds: number;
  progress_percent: number;
}

/**
 * Tracks meaningful playback instead of page load. Progress is emitted at
 * five-percent watched-time thresholds. Large currentTime jumps are treated as
 * seeks and do not inflate watched time or retention.
 */
export class PlaybackAnalyticsTracker {
  readonly playbackSessionId = crypto.randomUUID();
  private started = false;
  private completed = false;
  private lastMediaTime: number | null = null;
  private watchedSeconds = 0;
  private emittedBucket = 0;

  constructor(private readonly videoId: string, private readonly common: AnalyticsProperties = {}) {}

  private properties(player: HTMLVideoElement): PlaybackEventProperties {
    const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0;
    const progress = duration > 0 ? Math.min(100, (this.watchedSeconds / duration) * 100) : 0;
    return {
      ...this.common,
      video_id: this.videoId,
      playback_session_id: this.playbackSessionId,
      position_seconds: Math.max(0, player.currentTime || 0),
      duration_seconds: duration,
      watched_seconds: Math.min(this.watchedSeconds, duration || this.watchedSeconds),
      progress_percent: progress,
    };
  }

  play(player: HTMLVideoElement): void {
    const event = this.started ? "video_resumed" : "video_started";
    this.started = true;
    this.lastMediaTime = player.currentTime;
    trackEvent(event, this.properties(player));
  }

  pause(player: HTMLVideoElement): void {
    if (!this.started || this.completed || player.ended) return;
    trackEvent("video_paused", this.properties(player));
  }

  timeUpdate(player: HTMLVideoElement): void {
    if (!this.started || player.paused) {
      this.lastMediaTime = player.currentTime;
      return;
    }
    const current = player.currentTime;
    if (this.lastMediaTime !== null) {
      const delta = current - this.lastMediaTime;
      if (delta > 0 && delta <= 4) this.watchedSeconds += delta;
    }
    this.lastMediaTime = current;
    const duration = Number.isFinite(player.duration) ? player.duration : 0;
    const bucket = duration > 0 ? Math.floor((this.watchedSeconds / duration) * 20) * 5 : 0;
    if (bucket >= this.emittedBucket + 5 && bucket <= 100) {
      this.emittedBucket = bucket;
      trackEvent("video_progress", this.properties(player));
    }
  }

  ended(player: HTMLVideoElement): void {
    if (this.completed) return;
    this.completed = true;
    trackEvent("video_completed", this.properties(player));
  }

  auxiliary(name: "subtitle_enabled" | "subtitle_disabled" | "summary_opened" | "video_chat_opened" | "video_chat_message_sent", player: HTMLVideoElement): void {
    trackEvent(name, this.properties(player));
  }
}
