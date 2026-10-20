import React from "react";
import { Navigate } from "react-router-dom";
import { useTenantFeature } from "@/hooks/useTenantFeature";
import { useFinancePortal } from "@/hooks/useFinanceEntitlement";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Funding/credit is an opt-in vertical, never a platform default (§2/§9).
 * These guards keep funding-specific admin surfaces reachable ONLY for tenants
 * whose config turns the `funding_readiness` feature on (the credit/funding
 * Playbook enables it). Generic coaching/consulting/agency tenants never see
 * them — including via a direct URL.
 */

/**
 * FundingRoute — route-level guard. A non-funding tenant who navigates directly
 * to a funding URL is bounced back to /admin. While the flag resolves we render
 * nothing so finance content never flashes.
 */
export function FundingRoute({ children }: { children: React.ReactNode }) {
  const { enabled, loading } = useTenantFeature("funding_readiness");
  if (loading) return null;
  return enabled ? <>{children}</> : <Navigate to="/choose-account" replace />;
}

/**
 * FundingGate — inline guard for a finance block that lives *inside* a route
 * shared with non-finance content (e.g. the funding accuracy panel beside the
 * generic analytics dashboard). Hides its children for non-funding tenants and
 * during flag resolution; no redirect.
 */
export function FundingGate({ children }: { children: React.ReactNode }) {
  const { enabled } = useTenantFeature("funding_readiness");
  return enabled ? <>{children}</> : null;
}

/**
 * CustomerFinanceRoute — E09 F2: the /app funding and credit pages (Credit, Funding, Funding Journey, Financial
 * Profile, Business, Business Profile, Disputes) open only for a viewer whose business is finance-entitled
 * (useFinanceEntitlement: a customer's frame says so, or anyone else's current business does). Funding and credit
 * are a deliberate Marketplace install, never a default (owner ruling 2026-10-19), so a direct URL from any other
 * business goes back to the portal home. Staff keep these pages as today until their business has a deliberate
 * install (owner ruling Q5, option a; useFinancePortal). A skeleton holds the page while the answer is still coming, so finance
 * content never flashes; nothing is decided from a guess.
 */
export function CustomerFinanceRoute({ children }: { children: React.ReactNode }) {
  const { open, loading } = useFinancePortal();
  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading" data-testid="customer-finance-route-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  return open ? <>{children}</> : <Navigate to="/app" replace />;
}
