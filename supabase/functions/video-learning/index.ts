import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Thin authenticated proxy: Browser -> this Edge gateway -> private Modal
// learning_api -> Supabase persistence. The browser never calls Modal directly
// and no server secret lives here; the caller's bearer token is forwarded
// upstream, where the user is resolved and ownership is verified server-side.
const MODAL_LEARNING_URL = "https://sepehrrahimpour8--vidora-worker-learning-api.modal.run";
const ALLOWED_ORIGINS = new Set([
  "https://srsepehr.github.io",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, content-type, x-request-id, apikey",
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
        { error: { code: "LEARNING_ACCESS_DENIED", message_fa: "دسترسی به این سرویس مجاز نیست." } },
        { status: 403, headers: cors },
      );
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (req.method !== "POST") {
      return Response.json(
        { error: { code: "LEARNING_INVALID_OUTPUT", message_fa: "ساختار درخواست معتبر نیست." } },
        { status: 405, headers: cors },
      );
    }

    const auth = req.headers.get("authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) {
      return Response.json(
        { error: { code: "LEARNING_AUTH_REQUIRED", message_fa: "برای استفاده از تمرین ابتدا وارد حساب شوید." } },
        { status: 401, headers: cors },
      );
    }

    const body = await req.text();
    if (new TextEncoder().encode(body).byteLength > 4000) {
      return Response.json(
        { error: { code: "LEARNING_INVALID_OUTPUT", message_fa: "ساختار درخواست معتبر نیست." } },
        { status: 413, headers: cors },
      );
    }

    try {
      const upstream = await fetch(MODAL_LEARNING_URL, {
        method: "POST",
        headers: {
          "Authorization": auth,
          "Content-Type": "application/json",
          "X-Request-ID": req.headers.get("x-request-id") || "",
        },
        body,
      });

      const upstreamBody = await upstream.text();
      if (!upstream.ok) {
        let code = "LEARNING_UPSTREAM_ERROR";
        try {
          const parsed = JSON.parse(upstreamBody);
          if (typeof parsed?.error?.code === "string") code = parsed.error.code;
        } catch {
          // Upstream response was not JSON. Log only the structural fallback.
        }
        console.error(JSON.stringify({
          event: "video_learning_upstream_rejected",
          status: upstream.status,
          code,
        }));
      }

      return new Response(upstreamBody, {
        status: upstream.status,
        headers: {
          ...cors,
          "Content-Type": upstream.headers.get("content-type") || "application/json",
        },
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: "video_learning_upstream_unreachable",
        error_type: error instanceof Error ? error.name : "UnknownError",
      }));
      return Response.json(
        {
          error: {
            code: "LEARNING_PROVIDER_UNAVAILABLE",
            message_fa: "ارتباط با سرویس ساخت تمرین برقرار نشد. کمی بعد دوباره تلاش کنید.",
          },
        },
        { status: 503, headers: cors },
      );
    }
  },
};
