import { Helmet } from "react-helmet-async";
import { ClientApprovalsView } from "@/components/approvals/ClientApprovalsView";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";

// A customer page: it names the business and the customer's agent, never PAIGE (owner ruling, 2026-10-19).
export default function ClientApprovals() {
  const { agentName, businessName } = useCustomerIdentity();
  return (
    <div className="space-y-6">
      <Helmet>
        <title>{businessName ? `Approvals · ${businessName}` : "Approvals · Client Portal"}</title>
        <meta name="description" content={`See every action ${agentName} requested on your behalf, your current stage, and any steps that need your input.`} />
      </Helmet>
      <div>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Everything {agentName} requested on your behalf — what's open, what's resolved, and what (if anything) needs you.
        </p>
      </div>
      <ClientApprovalsView />
    </div>
  );
}
