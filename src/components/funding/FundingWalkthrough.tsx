import {
  Target,
  ClipboardCheck,
  Route,
  Layers,
  MapPin,
  Sparkles,
  ShieldAlert,
  Rocket,
} from "lucide-react";
import { PageWalkthrough, type WalkthroughStep } from "@/components/common/PageWalkthrough";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";

const STEPS: WalkthroughStep[] = [
  {
    num: 1,
    icon: Target,
    title: "Set your funding goal",
    what: "Tell {agent} your objective — working capital, equipment, real estate, expansion — plus how much, how fast, and what you'll use it for.",
    why: "Funding without a goal is gambling. The match engine prioritizes products that fit your actual use case, timeline, and amount. Generic searches return generic (bad) results.",
  },
  {
    num: 2,
    icon: ClipboardCheck,
    title: "Complete your Profile Completeness",
    what: "Fill out personal credit, business credit, banking data, revenue, time-in-business, and financials. Each field directly powers your match score.",
    why: "Lenders auto-decline incomplete files. The more we know, the more accurate your match — and the fewer inquiries you waste applying to products you won't qualify for.",
    hack: "Connect your business bank account via Plaid. Lenders weight 3 months of revenue data 10x heavier than self-reported numbers, which unlocks revenue-based products instantly.",
  },
  {
    num: 3,
    icon: ShieldAlert,
    title: "Pass the Separation Audit",
    what: "We verify your personal and business credit are properly separated — own EIN, bank account, phone, address. If they're co-mingled, you'll see a fix-it banner here.",
    why: "Co-mingled = lenders treat it as a sole prop and pull your personal credit for everything. Full separation is what unlocks EIN-only funding (no Personal Guarantee).",
  },
  {
    num: 4,
    icon: Layers,
    title: "Choose your Funding Track",
    what: "Personal Guarantee (PG) Track uses your personal credit. EIN-Only Track uses business credit only. Hybrid combines both. Each shows different products.",
    why: "EIN-only protects your personal credit and DTI but requires a stronger business profile. PG opens more doors fast but ties personal liability to the deal. Choose based on where you actually are today.",
  },
  {
    num: 5,
    icon: Route,
    title: "Follow your Funding Sequence",
    what: "{agent} stacks products in the right order — secured trade lines first, then store cards, then bank lines, then revenue-based capital. Each unlocks the next.",
    why: "Order matters more than amount. Apply out of sequence and you waste inquiries, trigger fraud reviews, and get denied for products you'd have qualified for in the right order.",
    hack: "Never apply for more than 2 products in the same 14-day window. Lenders see overlapping inquiries as 'loan stacking' and auto-decline — even on great files.",
  },
  {
    num: 6,
    icon: Sparkles,
    title: "Review your Product Matches",
    what: "Each match shows your fit score, qualification odds, expected approval amount, rate range, and exactly which fields helped or hurt your match.",
    why: "This is where you stop guessing. Apply only to products with 70%+ match scores. Skip the rest until you've fixed the gaps the score is calling out.",
  },
  {
    num: 7,
    icon: MapPin,
    title: "Search Regional Lenders",
    what: "Find local credit unions, community banks, and CDFIs in your state. These often beat national lenders on rate and approve files the big banks reject.",
    why: "Community banks and CDFIs have relationship-based underwriting — they look at your story, not just your score. They're often the unlock for borderline files national lenders pass on.",
  },
  {
    num: 8,
    icon: Rocket,
    title: "Apply with confidence",
    what: "When you're ready, {agent} drafts your outreach, prepares your document package, and tracks every application — submitted, in review, approved, funded.",
    why: "Organized applications get funded faster. Lenders measure response time and document quality. A clean package can move you from 'maybe' to 'approved' on the same call.",
  },
];

const named = (text: string, agent: string) => text.split("{agent}").join(agent);

export function FundingWalkthrough() {
  // A customer page: {agent} is the customer's agent (Cura, or the business's own name for it), never PAIGE.
  const { agentName } = useCustomerIdentity();
  return (
    <PageWalkthrough
      storageKey="funding_walkthrough_dismissed_v1"
      title="How to use this page"
      steps={STEPS.map((step) => ({ ...step, what: named(step.what, agentName), why: named(step.why, agentName), hack: step.hack && named(step.hack, agentName) }))}
    />
  );
}
