import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Bell, Share, Plus } from 'lucide-react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useToast } from '@/hooks/use-toast';

interface PushNotificationPromptProps {
  /** When true (default), automatically checks if prompt should show on mount */
  autoCheck?: boolean;
}

export const PushNotificationPrompt = ({ autoCheck = true }: PushNotificationPromptProps) => {
  const {
    isSupported,
    isIOS,
    isPWAInstalled,
    subscribe,
    dismissPrompt,
    shouldShowPrompt,
  } = usePushNotifications();
  const [open, setOpen] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!autoCheck || !isSupported) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const should = await shouldShowPrompt();
      if (!cancelled && should) {
        if (isIOS && !isPWAInstalled) {
          setShowIOSGuide(true);
        } else {
          setOpen(true);
        }
      }
    }, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [autoCheck, isSupported, isIOS, isPWAInstalled, shouldShowPrompt]);

  const handleEnable = async () => {
    setEnabling(true);
    const ok = await subscribe();
    setEnabling(false);
    if (ok) {
      toast({ title: 'Notifications enabled', description: 'You will be notified when it matters.' });
      setOpen(false);
    } else {
      toast({
        title: 'Could not enable notifications',
        description: 'Permission was denied or your browser does not support push.',
        variant: 'destructive',
      });
    }
  };

  const handleDismiss = async () => {
    await dismissPrompt();
    setOpen(false);
    setShowIOSGuide(false);
  };

  return (
    <>
      {/* Standard prompt */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
              <Bell className="h-7 w-7 text-accent" />
            </div>
            <DialogTitle className="text-center text-2xl font-serif">Stay in the Loop</DialogTitle>
            <DialogDescription className="text-center pt-2">
              Get instant notifications when your credit score changes, disputes are resolved, or new funding matches are found. We only notify you when it matters.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              onClick={handleEnable}
              disabled={enabling}
              className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
              size="lg"
            >
              {enabling ? 'Enabling…' : 'Enable Notifications'}
            </Button>
            <button
              onClick={handleDismiss}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
            >
              Maybe Later
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* iOS PWA install guide */}
      <Dialog open={showIOSGuide} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
              <Bell className="h-7 w-7 text-accent" />
            </div>
            <DialogTitle className="text-center text-2xl font-serif">Get Notifications on iPhone</DialogTitle>
            <DialogDescription className="text-center pt-2">
              To receive notifications on iPhone, first add this portal to your home screen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">1</div>
              <div className="flex items-center gap-2 text-sm">
                <span>Tap the</span>
                <Share className="h-4 w-4 text-accent" />
                <span>Share button in Safari</span>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">2</div>
              <div className="flex items-center gap-2 text-sm">
                <span>Select</span>
                <Plus className="h-4 w-4 text-accent" />
                <span className="font-medium">Add to Home Screen</span>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">3</div>
              <div className="text-sm">
                Open the app from your home screen and enable notifications.
              </div>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2 text-center"
          >
            Got it
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
};
