import React from "react";

export function FormErrorAlert({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-2xl border border-zinc-300 bg-zinc-100 px-4 py-3 text-sm font-medium leading-7 text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50">
      {message}
    </div>
  );
}

export function FormNotice({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-2xl border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm font-medium leading-6 text-zinc-800 dark:border-white/15 dark:bg-white/10 dark:text-zinc-100">
      {message}
    </div>
  );
}

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="mt-2 text-xs font-medium leading-6 text-zinc-700 dark:text-zinc-300">{message}</p>;
}

export function RetryState({ message, onRetry, retryLabel = "تلاش دوباره" }: { message: string; onRetry: () => void; retryLabel?: string }) {
  return (
    <div className="grid place-items-center gap-3 rounded-2xl border border-zinc-200 bg-white/70 p-8 text-center text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <p className="text-sm leading-7">{message}</p>
      <button className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-bold text-white dark:bg-white dark:text-zinc-950" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="grid place-items-center gap-2 rounded-2xl border border-zinc-200 bg-white/50 p-8 text-center text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <h3 className="text-base font-bold">{title}</h3>
      {description ? <p className="max-w-md text-sm leading-7 text-zinc-600 dark:text-zinc-400">{description}</p> : null}
    </div>
  );
}

export function OfflineState() {
  return <FormErrorAlert message="ارتباط با اینترنت برقرار نیست. اتصال خود را بررسی کنید و دوباره تلاش کنید." />;
}
