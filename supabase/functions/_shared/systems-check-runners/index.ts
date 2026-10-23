// systems-check-runners/index.ts — the §18 one-home barrel that registers all 11 Systems Check runner
// modules into the core's dispatch map (SYSTEMS_CHECK_DISPATCH) via registerRunner().
//
// A flavor edge function (systems-check-run-onboarding / -scheduled / -change) imports the core AND this
// barrel; importing the barrel is what populates the dispatch registry. The core reports any runner_key
// with no registered runner as an 'error' finding (fail-loud, §32) — so if a registry row's runner_key is
// ever mistyped or a module is missing here, it surfaces loudly, never as a silent pass.
//
// §13: REGISTERED_RUNNER_KEYS is exported so a smoke test / the edge fns can assert the 10 seeded catalog
// keys are all covered before a scan runs.

import { registerRunner } from "../systems-check-runner.ts";

import * as commsConfigured from "./comms_configured.ts";
import * as websiteConnected from "./website_connected.ts";
import * as socialHandlesCaptured from "./social_handles_captured.ts";
import * as externalAutomationDetected from "./external_automation_detected.ts";
import * as companyInfoPopulated from "./company_info_populated.ts";
import * as crmHasCustomers from "./crm_has_customers.ts";
import * as salesPipelineConfigured from "./sales_pipeline_configured.ts";
import * as revenueTrackingConfigured from "./revenue_tracking_configured.ts";
import * as paymentProcessorConnected from "./payment_processor_connected.ts";
import * as paymentMethodsDeclared from "./payment_methods_declared.ts";
import * as connectionsHealthy from "./connections_healthy.ts";

const MODULES = [
  commsConfigured,
  websiteConnected,
  socialHandlesCaptured,
  externalAutomationDetected,
  companyInfoPopulated,
  crmHasCustomers,
  salesPipelineConfigured,
  revenueTrackingConfigured,
  paymentProcessorConnected,
  paymentMethodsDeclared,
  connectionsHealthy,
] as const;

// Register each module's runner under its declared runner_key (idempotent-by-last-write in the core).
for (const m of MODULES) {
  registerRunner(m.runnerKey, m.run);
}

/** The 11 runner_keys this barrel registers — matches the catalog seeds: the L1 10 (post-§38 correction: row
 *  check_id='payment_method_options' now dispatches to 'payment_methods_declared') plus
 *  connections_healthy (EXP10 ALG-12, 20271113540000). */
export const REGISTERED_RUNNER_KEYS: readonly string[] = MODULES.map((m) => m.runnerKey);
