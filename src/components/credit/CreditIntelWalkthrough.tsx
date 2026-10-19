import {
  Upload,
  Gauge,
  PieChart,
  FileSearch,
  Layers,
  History,
  CalendarClock,
  ListChecks,
  BellRing,
} from "lucide-react";
import { PageWalkthrough, type WalkthroughStep } from "@/components/common/PageWalkthrough";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";

const STEPS: WalkthroughStep[] = [
  {
    num: 1,
    icon: Upload,
    title: "Upload your reports",
    what: "Start by uploading your Experian, TransUnion, and Equifax reports (PDF). {agent} extracts every account, balance, score, and negative item automatically.",
    why: "Lenders pull different bureaus. Without all 3, you're funding blind — you can't fix what you can't see.",
  },
  {
    num: 2,
    icon: Gauge,
    title: "Review your bureau scores",
    what: "Compare your FICO across all 3 bureaus side by side. Notice which bureau is your strongest — and which is dragging you down.",
    why: "A 30-point gap between bureaus is common. Knowing your best score tells you which lenders to target first (banks pull Equifax, fintechs lean TransUnion, mortgage uses all 3).",
  },
  {
    num: 3,
    icon: PieChart,
    title: "Check your credit factors",
    what: "See the 5 FICO factors broken out: payment history (35%), utilization (30%), credit age (15%), credit mix (10%), inquiries (10%).",
    why: "FICO is a math equation. Once you see which factor is costing you points, you know exactly where to put your effort for the biggest score lift.",
  },
  {
    num: 4,
    icon: FileSearch,
    title: "Open your Credit File Health Assessment",
    what: "Drill into each bureau report — every negative account, every positive tradeline, and your overall file structure (account types you have vs. what you're missing).",
    why: "Lenders want to see 10+ accounts with the right mix: revolving (credit cards), installment (auto/personal loans), and mortgage. This is where you spot the holes.",
    hack: "Target: 10+ accounts with at least 3 revolving, 1+ installment, and ideally 1 mortgage. Most denials trace back to a thin or unbalanced file.",
  },
  {
    num: 5,
    icon: Layers,
    title: "Understand Comparable Credit (per bureau)",
    what: "This shows accounts on your file that lenders consider 'comparable' — same industry, same size, same risk profile as the loan you want.",
    why: "If you're applying for a $25K auto loan, lenders want to see you've handled comparable credit before. No comparable credit = automatic decline, regardless of score.",
  },
  {
    num: 6,
    icon: History,
    title: "Historical Comparable Credit",
    what: "Closed-but-positive accounts from your past — paid-off auto loans, mortgages, old credit cards in good standing.",
    why: "These work in your favor when you sign as a Personal Guarantor (PG) for business funding. Lenders treat closed positives as proof you can handle and pay off real debt.",
  },
  {
    num: 7,
    icon: CalendarClock,
    title: "Credit Age",
    what: "Your average account age across all tradelines. Goal: 5+ years average age.",
    why: "Credit age is 15% of your FICO. A young file caps your score — you can have perfect payments and still be stuck under 700 if your average age is under 2 years.",
    hack: "Adding no more than 2 old Authorized User (AU) accounts on someone's seasoned credit cards (perfect payment, low utilization) can age your file overnight. Choose AU accounts older than 5 years for max impact.",
  },
  {
    num: 8,
    icon: ListChecks,
    title: "Credit File Action Plan",
    what: "{agent}'s prioritized list of moves to strengthen your consumer report — disputes to file, accounts to add, balances to pay down, AU tradelines to consider.",
    why: "This is your roadmap. Every step is sequenced for maximum score impact in the shortest time — no guessing, no wasted moves.",
  },
  {
    num: 9,
    icon: BellRing,
    title: "Credit Alerts",
    what: "Real-time alerts when something changes on your report — new inquiry, balance spike, negative item, score drop.",
    why: "Catch fraud early, react to bureau changes before they cost you, and stay ahead of identity issues. This is your early-warning system.",
  },
];

const named = (text: string, agent: string) => text.split("{agent}").join(agent);

export function CreditIntelWalkthrough() {
  // A customer page: {agent} is the customer's agent (Cura, or the business's own name for it), never PAIGE.
  const { agentName } = useCustomerIdentity();
  return (
    <PageWalkthrough
      storageKey="credit_intel_walkthrough_dismissed_v1"
      title="How to use this page"
      steps={STEPS.map((step) => ({ ...step, what: named(step.what, agentName), why: named(step.why, agentName), hack: step.hack && named(step.hack, agentName) }))}
    />
  );
}
