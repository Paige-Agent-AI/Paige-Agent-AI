import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { trustedAppOrigin } from "@/lib/hostRouting";
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ForgotPasswordDialog = ({ open, onOpenChange }: Props) => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        // Always an app origin: an unknown or hostile hostname never picks the email's target.
        redirectTo: `${trustedAppOrigin(window.location)}/reset-password`,
      });
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } else {
        setIsSent(true);
      }
    } catch {
      toast({ title: "Error", description: "Something went wrong.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsSent(false);
    setEmail("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[420px]">
        {isSent ? (
          <div className="text-center py-4 space-y-4">
            <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center mx-auto">
              <Mail className="w-7 h-7 text-accent" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-center">Check your email</DialogTitle>
              <DialogDescription className="text-center">
                We sent a password reset link to <strong>{email}</strong>. Click the link in the email to set a new password.
              </DialogDescription>
            </DialogHeader>
            <Button variant="outline" onClick={handleClose} className="w-full mt-2">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Sign In
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reset your password</DialogTitle>
              <DialogDescription>
                Enter your email address and we'll send you a link to reset your password.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="reset-email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Email Address
                </Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-12 bg-muted/50 border-border/60 focus:border-accent focus:ring-accent/20"
                />
              </div>
              <Button type="submit" className="w-full h-11 font-semibold rounded-xl" disabled={isLoading}>
                {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</> : "Send Reset Link"}
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
