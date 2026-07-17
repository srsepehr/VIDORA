import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Thin authenticated dispatch proxy: Browser -> this Edge gateway -> private
// Modal `trigger` endpoint, which SPAWNS a scale-to-zero drain of the durable
// job queue. The browser never calls Modal directly and no server secret lives
// here. This request only asks the worker to start draining already-enqueued
// work; it never creates, claims, or mutates a job, so it is safe to call after
// every enqueue and safe to retry. A failure here is non-fatal: the enqueued
// job stays queued in Postgres and is recovered by a later dispatch or drain.
const MODAL_TRIGGER_URL = "https://sepehrrahimpour8--vidora-worker-trigger.modal.run";
const ALLOWED_ORIGINS = new Set([
  "https://srsepehr.github.io",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

export default {
  async fetch(req: Request) {
    const origin = req.headers.get("origin");
    const cors = corsHeaders(origin);

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return Response.json(
        { error: { code: "DISPATCH_ACCESS_DENIED", message_fa: "دسترسی به این سرویس مجاز نیست." } },
        { status: 403, headers: cors },
      );
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (req.method !== "POST") {
      return Response.json(
        { error: { code: "DISPATCH_INVALID", message_fa: "درخواست معتبر نیست." } },
        { status: 405, headers: cors },
      );
    }

    // Require an authenticated caller so the dispatch endpoint is not an open
    // "spin up a worker" trigger. The Modal side only drains already-enqueued,
    // authenticated jobs, so no per-job authorization is needed here.
    const auth = req.headers.get("authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) {
      return Response.json(
        { error: { code: "DISPATCH_AUTH_REQUIRED", message_fa: "برای شروع پردازش ابتدا وارد حساب شوید." } },
        { status: 401, headers: cors },
      );
    }

    try {
      const upstream = await fetch(MODAL_TRIGGER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await upstream.text();
      if (!upstream.ok) {
        console.error(JSON.stringify({ event: "video_dispatch_upstream_rejected", status: upstream.status }));
      }
      return new Response(body || JSON.stringify({ dispatched: upstream.ok }), {
        status: upstream.ok ? 202 : upstream.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (error) {
      // Non-fatal: the durable queue keeps the job recoverable.
      console.error(JSON.stringify({
        event: "video_dispatch_upstream_unreachable",
        error_type: error instanceof Error ? error.name : "UnknownError",
      }));
      return Response.json(
        { error: { code: "DISPATCH_UPSTREAM_UNAVAILABLE", message_fa: "شروع خودکار پردازش ممکن نشد؛ به‌زودی دوباره تلاش می‌شود." } },
        { status: 503, headers: cors },
      );
    }
  },
};
