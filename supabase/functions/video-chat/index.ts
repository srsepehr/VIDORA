import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODAL_CHAT_URL = "https://sepehrrahimpour8--vidora-worker-chat-api.modal.run";
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
        { error: { code: "CHAT_ACCESS_DENIED", message_fa: "دسترسی به این سرویس مجاز نیست." } },
        { status: 403, headers: cors },
      );
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (req.method !== "POST") {
      return Response.json(
        { error: { code: "CHAT_INVALID_OUTPUT", message_fa: "ساختار درخواست معتبر نیست." } },
        { status: 405, headers: cors },
      );
    }

    const auth = req.headers.get("authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) {
      return Response.json(
        { error: { code: "CHAT_AUTH_REQUIRED", message_fa: "برای پرسش از ویدیو ابتدا وارد حساب شوید." } },
        { status: 401, headers: cors },
      );
    }

    const body = await req.text();
    if (new TextEncoder().encode(body).byteLength > 12000) {
      return Response.json(
        { error: { code: "CHAT_QUESTION_TOO_LONG", message_fa: "پرسش بیش از حد طولانی است." } },
        { status: 413, headers: cors },
      );
    }

    try {
      const upstream = await fetch(MODAL_CHAT_URL, {
        method: "POST",
        headers: {
          "Authorization": auth,
          "Content-Type": "application/json",
          "X-Request-ID": req.headers.get("x-request-id") || "",
        },
        body,
      });

      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: {
          ...cors,
          "Content-Type": upstream.headers.get("content-type") || "application/json",
        },
      });
    } catch {
      return Response.json(
        { error: { code: "CHAT_PROVIDER_UNAVAILABLE", message_fa: "پاسخ‌گویی هوشمند موقتاً در دسترس نیست." } },
        { status: 503, headers: cors },
      );
    }
  },
};
