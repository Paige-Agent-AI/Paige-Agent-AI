// The retired title role grants nothing in the credit and funding code. A person holding the
// platform-wide `coach` role cannot analyse a credit report or a financial document, read a lender
// summary or credit predictions, record an outcome for someone else, manage a client's accounts, edit
// certifications, or open the broker workspace as staff. An assignment alone does not let anyone sync
// credit data into a client's records: an assignment opens reads, and whether it opens writes is a
// product decision this change does not make.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

const FILES = [
  "supabase/functions/analyze-credit-report/index.ts",
  "supabase/functions/analyze-financial-document/index.ts",
  "supabase/functions/generate-lender-summary/index.ts",
  "supabase/functions/generate-credit-predictions/index.ts",
  "supabase/functions/ingest-rag-outcome/index.ts",
  "supabase/functions/sync-credit-report-data/index.ts",
  "src/pages/broker/BrokerWorkspace.tsx",
  "src/components/dashboard/business-profile/BusinessInfrastructureAssessment.tsx",
  "src/components/dashboard/business-profile/FundingProfileSection.tsx",
  "src/components/credit/AccountManager.tsx",
  "src/components/dashboard/ClientFileView.tsx",
  "src/components/dashboard/AdminAccountManagement.tsx",
];

// Any code that reads the role or types an actor with it: an RPC asking for it, a comparison, a list
// or includes() containing it, a union or default naming it, or a flag named after it. The stored
// modification-source label 'coach_ui' is data, not a role, and is not matched.
const ROLE_READ =
  /_role:\s*["']coach["']|===?\s*["']coach["']|\[[^\]]*["']coach["'][^\]]*\]|includes\(\s*["']coach["']\s*\)|\|\s*["']coach["']|["']coach["']\s*\||=\s*["']coach["']|\bisCoach\b|\bisAdminOrCoach\b/;

const codeLines = (path: string) =>
  read(path)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));

describe("the retired coach role grants nothing in credit and funding", () => {
  it("is read by none of the gates", () => {
    const offenders = FILES.filter((path) => codeLines(path).some((line) => ROLE_READ.test(line)));
    expect(offenders).toEqual([]);
  });

  it("does not let an assignment alone sync credit data into a client's records", () => {
    const sync = codeLines("supabase/functions/sync-credit-report-data/index.ts").join("\n");
    expect(sync).not.toMatch(/from\(\s*["']coach_clients["']\s*\)/);
  });
});
