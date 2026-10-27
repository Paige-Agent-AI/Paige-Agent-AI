import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";
import { toast } from "sonner";
import { MessageSquare, Phone, Mail, Calendar, Loader2, Crown } from "lucide-react";

export function ContactSupport() {
  const { planSlug } = useSubscription();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    subject: "",
    category: "",
    message: "",
    preferredContact: "email",
    requestConsultation: false,
  });

  const isPremiumOrEnterprise = planSlug === "premium" || planSlug === "enterprise";
  const isEnterprise = planSlug === "enterprise";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // planSlug is intentionally NOT sent: the support SLA + routing inbox are
      // entitlements resolved SERVER-SIDE from the subscription row (a client
      // value would be spoofable). The local planSlug only drives this UI's copy.
      const { data, error } = await supabase.functions.invoke('send-support-request', {
        body: {
          ...formData,
          userEmail: user.email,
        },
      });

      if (error) {
        // The function answers a non-2xx with an honest body. An UNCONFIRMED send means the email
        // service may already have the request: telling the person it failed would make them send it
        // twice, so they hear exactly that, and the form keeps what they typed.
        const body = await readFunctionErrorBody(error, data);
        const said = typeof body?.error === "string" ? body.error : null;
        if (body?.unconfirmed === true) {
          toast.warning("We couldn't confirm it reached our team", {
            description: said ?? "It may have. Please don't send it again; email support@paigeagent.ai if you haven't heard back.",
          });
          return;
        }
        throw new Error(said ?? error.message);
      }

      toast.success("Request submitted!", {
        description: isEnterprise 
          ? "Your dedicated success manager will contact you within 2 hours."
          : isPremiumOrEnterprise
          ? "Our team will respond within 24 hours."
          : "We'll get back to you within 48 hours.",
      });

      // Reset form
      setFormData({
        subject: "",
        category: "",
        message: "",
        preferredContact: "email",
        requestConsultation: false,
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing; CI whole-file-lints changed files
    } catch (error: any) {
      console.error('Support request error:', error);
      toast.error("Failed to submit request", {
        description: error.message || "Please try again or email support@paigeagent.ai",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Contact Options Header */}
      <Card className="p-6 bg-gradient-primary text-primary-foreground">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold mb-2">Contact & Support</h2>
            <p className="opacity-90">
              {isEnterprise 
                ? "Direct access to your dedicated success manager and white-glove support"
                : isPremiumOrEnterprise
                ? "Priority support with expedited response times"
                : "Get help from our support team"}
            </p>
          </div>
          <Badge className="bg-primary-foreground/20 text-primary-foreground border-0">
            {planSlug === "enterprise" ? "Enterprise" : planSlug === "premium" ? "Premium" : planSlug === "professional" ? "Professional" : "Starter"}
          </Badge>
        </div>
      </Card>

      {/* Enterprise Exclusive Features */}
      {isEnterprise && (
        <Card className="p-6 border-accent bg-accent/5">
          <div className="flex items-center gap-2 mb-4">
            <Crown className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-semibold">Enterprise Benefits</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <Phone className="w-5 h-5 text-accent mt-0.5" />
              <div>
                <p className="font-semibold">Dedicated Success Manager</p>
                <p className="text-sm text-muted-foreground">Direct phone line to your personal advisor</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-accent mt-0.5" />
              <div>
                <p className="font-semibold">Monthly Strategy Sessions</p>
                <p className="text-sm text-muted-foreground">1-on-1 consultation on the 3M Framework</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MessageSquare className="w-5 h-5 text-accent mt-0.5" />
              <div>
                <p className="font-semibold">Priority Response</p>
                <p className="text-sm text-muted-foreground">2-hour response time guarantee</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-accent mt-0.5" />
              <div>
                <p className="font-semibold">White-Glove Service</p>
                <p className="text-sm text-muted-foreground">Concierge-level support for all requests</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Support Request Form */}
      <Card className="p-6">
        <h3 className="text-xl font-semibold mb-6">Submit Support Request</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category">Request Type</Label>
            <Select
              value={formData.category}
              onValueChange={(value) => setFormData({ ...formData, category: value })}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="technical">Technical Support</SelectItem>
                <SelectItem value="billing">Billing & Subscription</SelectItem>
                <SelectItem value="accel">ACCEL Program Help</SelectItem>
                <SelectItem value="build_personal">BUILD Personal Program</SelectItem>
                <SelectItem value="build_business">BUILD Business Program</SelectItem>
                {isEnterprise && (
                  <>
                    <SelectItem value="3m_framework">3M Framework Consultation</SelectItem>
                    <SelectItem value="strategy_session">Schedule Strategy Session</SelectItem>
                  </>
                )}
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              placeholder="Brief description of your request"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              placeholder="Provide details about your request..."
              rows={6}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact">Preferred Contact Method</Label>
            <Select
              value={formData.preferredContact}
              onValueChange={(value) => setFormData({ ...formData, preferredContact: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
                {isEnterprise && <SelectItem value="scheduled_call">Scheduled Call with Manager</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {(isPremiumOrEnterprise) && (
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="consultation"
                checked={formData.requestConsultation}
                onChange={(e) => setFormData({ ...formData, requestConsultation: e.target.checked })}
                className="rounded border-border"
              />
              <Label htmlFor="consultation" className="cursor-pointer">
                {isEnterprise 
                  ? "Schedule a 3M Framework consultation session"
                  : "Request a consultation call (Premium feature)"}
              </Label>
            </div>
          )}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-gradient-primary text-primary-foreground"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Request"
            )}
          </Button>
        </form>
      </Card>

      {/* Response Time Info */}
      <Card className="p-4 bg-muted">
        <div className="flex items-start gap-3">
          <MessageSquare className="w-5 h-5 text-muted-foreground mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-semibold text-foreground mb-1">Expected Response Time</p>
            <p>
              {isEnterprise 
                ? "Enterprise: 2 hours or less (guaranteed)"
                : isPremiumOrEnterprise
                ? "Premium: Within 24 hours (priority queue)"
                : planSlug === "professional"
                ? "Professional: Within 48 hours"
                : "Starter: Within 72 hours"}
            </p>
            {!isEnterprise && (
              <p className="mt-2">
                <span className="text-accent font-semibold">Upgrade to Enterprise</span> for dedicated support and 2-hour response times.
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Direct Contact Info for Enterprise */}
      {isEnterprise && (
        <Card className="p-6 bg-gradient-accent text-accent-foreground">
          <h3 className="text-lg font-semibold mb-4">Direct Contact Information</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5" />
              <div>
                <p className="font-semibold">Success Manager Hotline</p>
                <p className="opacity-90">Available after first strategy session</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5" />
              <div>
                <p className="font-semibold">Priority Email</p>
                <p className="opacity-90">enterprise@paigeagent.ai</p>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
