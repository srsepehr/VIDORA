import React from "react";
import { getCachedSession } from "../../lib/auth";
import { getLastSafeError, toAppError } from "../../lib/app-error";
import { getBrowserEnv, isBackendConfigured } from "../../lib/env";

interface DiagnosticsState {
  configured: boolean;
  hostname: string | null;
  authReachable: boolean | null;
  databaseReachable: boolean | null;
  requiredTablesPresent: boolean | null;
  sessionState: "authenticated" | "guest";
  userId: string | null;
  profileFound: boolean | null;
  plansFound: boolean | null;
  lastSafeError: ReturnType<typeof getLastSafeError>;
  error: string | null;
}

function redactId(value?: string): string | null {
  if (!value) return null;
  if (value.length <= 10) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

async function runDiagnostics(): Promise<DiagnosticsState> {
  const session = getCachedSession();
  const state: DiagnosticsState = {
    configured: isBackendConfigured(),
    hostname: null,
    authReachable: null,
    databaseReachable: null,
    requiredTablesPresent: null,
    sessionState: session ? "authenticated" : "guest",
    userId: redactId(session?.user.id),
    profileFound: null,
    plansFound: null,
    lastSafeError: getLastSafeError(),
    error: null,
  };

  let env;
  try {
    env = getBrowserEnv();
    state.hostname = new URL(env.supabaseUrl).hostname;
  } catch (error) {
    state.error = toAppError(error).messageFa;
    return state;
  }

  const anonHeaders = {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${env.supabaseAnonKey}`,
  };

  try {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: anonHeaders });
    state.authReachable = response.ok;
  } catch {
    state.authReachable = false;
  }

  try {
    const plansResponse = await fetch(`${env.supabaseUrl}/rest/v1/plans?select=id,slug&limit=1`, { headers: anonHeaders });
    state.databaseReachable = plansResponse.ok;
    if (plansResponse.ok) {
      const plans = await plansResponse.json();
      state.plansFound = Array.isArray(plans) && plans.length > 0;
    }
  } catch {
    state.databaseReachable = false;
  }

  try {
    const categoriesResponse = await fetch(`${env.supabaseUrl}/rest/v1/library_categories?select=id&limit=1`, { headers: anonHeaders });
    state.requiredTablesPresent = Boolean(state.databaseReachable && categoriesResponse.ok);
  } catch {
    state.requiredTablesPresent = false;
  }

  if (session) {
    try {
      const profileResponse = await fetch(`${env.supabaseUrl}/rest/v1/profiles?select=id&limit=1`, {
        headers: {
          apikey: env.supabaseAnonKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
      if (profileResponse.ok) {
        const profiles = await profileResponse.json();
        state.profileFound = Array.isArray(profiles) && profiles.length > 0;
      } else {
        state.profileFound = false;
      }
    } catch {
      state.profileFound = false;
    }
  }

  return state;
}

function StatusValue({ value }: { value: boolean | null | string }) {
  const label = value === true ? "yes" : value === false ? "no" : value ?? "unknown";
  return <strong>{label}</strong>;
}

export function AuthDiagnostics() {
  const [state, setState] = React.useState<DiagnosticsState | null>(null);

  React.useEffect(() => {
    let alive = true;
    runDiagnostics().then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!state) {
    return <main className="min-h-screen bg-zinc-950 p-8 text-white">Loading diagnostics...</main>;
  }

  return (
    <main className="min-h-screen bg-zinc-950 p-8 text-white" dir="ltr">
      <section className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/[0.04] p-6">
        <h1 className="text-2xl font-bold">Vidora Auth Diagnostics</h1>
        <p className="mt-2 text-sm text-zinc-400">Development only. No keys, tokens, or passwords are displayed.</p>
        <dl className="mt-6 grid gap-3 text-sm">
          <div className="flex justify-between gap-6 border-b border-white/10 pb-2"><dt>Supabase environment configured</dt><dd><StatusValue value={state.configured} /></dd></div>
          <div className="flex justify-between gap-6 border-b border-white/10 pb-2"><dt>Supabase hostname</dt><dd><StatusValue value={state.hostname} /></dd></div>
          <div className="flex justify-between gap-6 border-b border-white/10 pb-2"><dt>Auth API reachable</dt><dd><StatusValue value={state.authReachable} /></dd></div>
          <div className="flex justify-between gap-6 border-b border-white/10 pb-2"><dt>Database reachable</dt><dd><StatusValue value={state.databaseReachable} /></dd></div>
          <div className="flex justify-between gap-6 border-b border-white/10 pb-2"><dt>Required tables present</dt><dd><StatusValue value={state.requiredTablesPresent} /></dd></div>
          <div className="flex justify-between gap-6 border-b border-white/10 pb-2"><dt>Session state</dt><dd><StatusValue value={state.sessionState} /></dd></div>
          <div className="flex justify-between gap-6 border-b border-white/10 pb-2"><dt>User ID</dt><dd><StatusValue value={state.userId} /></dd></div>
          <div className="flex justify-between gap-6 border-b border-white/10 pb-2"><dt>Profile found</dt><dd><StatusValue value={state.profileFound} /></dd></div>
          <div className="flex justify-between gap-6 border-b border-white/10 pb-2"><dt>Plans found</dt><dd><StatusValue value={state.plansFound} /></dd></div>
          <div className="flex justify-between gap-6 border-b border-white/10 pb-2"><dt>Last safe auth error code</dt><dd><StatusValue value={state.lastSafeError?.errorCode || "none"} /></dd></div>
        </dl>
        {state.error ? <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-sm text-zinc-200">{state.error}</p> : null}
      </section>
    </main>
  );
}
