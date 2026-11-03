import type { PlanIntent } from "@/lib/auth/signupPlanIntent";

export const SOLO_BETA_PLAN_SLUG = "solo";
export const SOLO_BETA_OFFER_CODE = "paige-solo-beta-monthly-v1";
export const SOLO_BETA_SUCCESS_PATH = "/welcome?checkout=success";
export const SOLO_BETA_CANCEL_PATH = "/welcome?checkout=cancelled";

export const soloBetaDisplayIntent = (): PlanIntent => ({
  plan: SOLO_BETA_PLAN_SLUG,
  billing: "monthly",
});

export function isSoloBetaPlan(value: string | null | undefined): boolean {
  return value === SOLO_BETA_PLAN_SLUG;
}

export function soloBetaCheckoutBody() {
  return {
    offer_code: SOLO_BETA_OFFER_CODE,
    success_path: SOLO_BETA_SUCCESS_PATH,
    cancel_path: SOLO_BETA_CANCEL_PATH,
  } as const;
}

export function soloBetaSignupPath(): string {
  return "/auth?mode=signup&plan=solo&billing=monthly";
}

export function keepPublicSoloPlan<T extends { slug: string; is_active: boolean }>(plans: readonly T[]): T[] {
  return plans.filter((plan) => plan.is_active && plan.slug === SOLO_BETA_PLAN_SLUG);
}

export const VERIFIED_SUBSCRIPTION_STATUSES = new Set(["trialing", "active"]);

export function isVerifiedSoloEntitlement(row: { plan_slug?: string | null; status?: string | null } | null): boolean {
  return Boolean(
    row
      && row.plan_slug === SOLO_BETA_PLAN_SLUG
      && row.status
      && VERIFIED_SUBSCRIPTION_STATUSES.has(row.status),
  );
}

export type SoloAuthRecoveryState = "expired" | "denied" | "provider_error";

export function soloAuthRecoveryFromUrl(search: string, hash: string): SoloAuthRecoveryState | null {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const classify = (params: URLSearchParams) => soloAuthRecoveryState({
    error: params.get("error"),
    errorCode: params.get("error_code"),
    description: params.get("error_description"),
  });
  return classify(query) ?? classify(fragment);
}

export function soloAuthRecoveryState(input: { error?: string | null; errorCode?: string | null; description?: string | null }): SoloAuthRecoveryState | null {
  const value = `${input.error ?? ""} ${input.errorCode ?? ""} ${input.description ?? ""}`.toLowerCase();
  if (!value.trim()) return null;
  if (/expired|otp_expired|link.*invalid/.test(value)) return "expired";
  if (/access_denied|denied|cancelled|canceled/.test(value)) return "denied";
  return "provider_error";
}
