import React from "react";
import { AlertTriangle, Loader2, ShieldX } from "lucide-react";
import { AdminApp } from "./AdminApp";
import { fetchAdminContext } from "../lib/admin";
import { restoreAuthSession, signOut, subscribeAuthState, type AuthSession } from "../lib/auth";
import type { AdminContext } from "../lib/admin-permissions";
import { buildAuthHash } from "../lib/auth-intent";
import { logAppError, toAppError } from "../lib/app-error";
import { sanitizeReturnTo } from "../lib/return-to";

type State =
  | { kind: "loading"; session: null; context: null; message: string }
  | { kind: "ready"; session: AuthSession; context: AdminContext; message: "" }
  | { kind: "forbidden" | "error"; session: AuthSession | null; context: null; message: string };

function AdminGateState({ kind, message, retry }: { kind: State["kind"]; message: string; retry?: () => void }) {
  const Icon = kind === "loading" ? Loader2 : kind === "forbidden" ? ShieldX : AlertTriangle;
  return (
    <main className="adm-gate" dir="rtl">
      <section>
        <Icon size={28} className={kind === "loading" ? "adm-spin" : ""} />
        <span>{kind === "forbidden" ? "HTTP 403" : "VIDORA ADMIN"}</span>
        <h1>{kind === "forbidden" ? "دسترسی مدیریتی ندارید" : kind === "loading" ? "در حال بررسی دسترسی…" : "اتصال پنل مدیریت برقرار نشد"}</h1>
        <p>{message}</p>
        <div>{retry ? <button onClick={retry}>تلاش دوباره</button> : null}<a href="#/dashboard">بازگشت به داشبورد</a></div>
      </section>
    </main>
  );
}

export function ProtectedAdmin({ returnTo = "/admin" }: { returnTo?: string }) {
  const [revision, setRevision] = React.useState(0);
  const [state, setState] = React.useState<State>({ kind: "loading", session: null, context: null, message: "نشست و نقش مدیریتی از سرور بررسی می‌شود." });

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const resolve = async () => {
      setState({ kind: "loading", session: null, context: null, message: "نشست و نقش مدیریتی از سرور بررسی می‌شود." });
      const session = await restoreAuthSession();
      if (!session) {
        window.location.hash = buildAuthHash({ intent: "general-entry", returnTo: sanitizeReturnTo(returnTo, "/admin") });
        return;
      }
      try {
        const context = await fetchAdminContext(session, controller.signal);
        if (alive) setState({ kind: "ready", session, context, message: "" });
      } catch (error) {
        const appError = toAppError(error);
        logAppError(appError, "ProtectedAdmin.fetchAdminContext");
        if (alive) setState({ kind: appError.httpStatus === 403 ? "forbidden" : "error", session, context: null, message: appError.messageFa });
      }
    };
    void resolve().catch((error) => {
      const appError = toAppError(error);
      if (alive) setState({ kind: "error", session: null, context: null, message: appError.messageFa });
    });
    const unsubscribe = subscribeAuthState((session) => {
      if (!session) window.location.hash = buildAuthHash({ intent: "general-entry", returnTo: "/admin" });
    });
    return () => { alive = false; controller.abort(); unsubscribe(); };
  }, [returnTo, revision]);

  if (state.kind !== "ready") return <AdminGateState kind={state.kind} message={state.message} retry={state.kind === "error" ? () => setRevision((value) => value + 1) : undefined} />;
  return <AdminApp session={state.session} context={state.context} onSignOut={() => { void signOut().finally(() => { window.location.hash = "#/"; }); }} />;
}
