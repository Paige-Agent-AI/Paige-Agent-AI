import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Compass, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";

/**
 * [§194] Static repositioning notice. Legacy dispute tables have been
 * dropped from the platform — Paige provides credit MONITORING only,
 * never credit REPAIR. CSV export removed with the source tables.
 * It is a customer page (/app/disputes), so it speaks as the portal and names the customer's agent;
 * PAIGE is the owner's COO and is not part of the customer's portal (owner ruling, 2026-10-19).
 */
export function RepositioningNotice() {
  const navigate = useNavigate();
  const { agentName } = useCustomerIdentity();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="text-center space-y-3">
        <Badge className="bg-accent/10 text-accent border-accent/20">
          Credit Monitoring Only
        </Badge>
        <h1 className="text-3xl font-bold text-foreground">
          This portal offers funding intelligence
        </h1>
        <p className="text-muted-foreground">
          It provides credit monitoring, analytics, and funding
          intelligence — not credit repair. Dispute filing, letter
          generation, and bureau challenges are outside our scope.
        </p>
      </div>

      <Card className="p-6 bg-card border-border space-y-4">
        <div className="flex items-start gap-3">
          <Compass className="w-5 h-5 text-accent mt-1 flex-shrink-0" />
          <div>
            <h2 className="font-semibold text-foreground mb-1">
              Looking for credit repositioning services?
            </h2>
            <p className="text-sm text-muted-foreground">
              Dispute filing and credit repositioning are outside this portal's scope. You
              can use the CFPB's free self-help dispute tools to address items on your
              report directly.
            </p>
            <Button variant="outline" className="mt-4 gap-2" asChild>
              <a
                href="https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open CFPB Self-Help Tools
                <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-gradient-to-br from-accent/5 to-gold/5 border-accent/20">
        <h2 className="font-semibold text-foreground mb-2">What this portal does</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Credit monitoring, bureau intelligence, and funding matching for
          small business owners — so you can see, track, and act on your
          personal and business credit profile as you qualify for capital.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate("/app/credit")} className="bg-gradient-gold text-primary">
            View Credit Intelligence
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/app/funding")}>
            See Funding Matches
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/app")}>
            Ask {agentName}
          </Button>
        </div>
      </Card>

      <p className="text-xs text-center text-muted-foreground">
        Questions? Email{" "}
        <a href="mailto:support@paigeagent.ai" className="underline">
          support@paigeagent.ai
        </a>
      </p>
    </div>
  );
}
