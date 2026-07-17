import { getBrowserEnv } from "./env";

export interface PublicPlan {
  id: string;
  slug: string;
  name_fa: string;
  description_fa: string;
  price: number;
  currency: string;
  billing_period_days: number;
  included_minutes: number;
  max_file_size_bytes: number;
  max_video_duration_seconds: number;
  sort_order: number;
}

export async function fetchPublicPlans(signal?: AbortSignal): Promise<PublicPlan[]> {
  const env = getBrowserEnv();
  const select = "id,slug,name_fa,description_fa,price,currency,billing_period_days,included_minutes,max_file_size_bytes,max_video_duration_seconds,sort_order";
  const response = await fetch(`${env.supabaseUrl}/rest/v1/plans?select=${select}&is_active=eq.true&order=sort_order.asc`, {
    signal,
    headers: { apikey: env.supabaseAnonKey, Authorization: `Bearer ${env.supabaseAnonKey}` },
  });
  if (!response.ok) throw new Error(`Plans request failed with ${response.status}`);
  return (await response.json()) as PublicPlan[];
}

export function formatPlanPrice(plan: PublicPlan, locale = "fa-IR"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: plan.currency, maximumFractionDigits: 0 }).format(plan.price);
}
