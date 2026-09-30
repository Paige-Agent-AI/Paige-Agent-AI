import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

// VAPID public key — must match the one set in edge function secrets
// This is a publishable key, safe to include in client code.
// Will be fetched from edge function on first use to ensure it matches server config.
let cachedVapidKey: string | null = null;

const isIOSDevice = (): boolean => {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
};

const isStandalone = (): boolean => {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
};

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const fetchVapidKey = async (): Promise<string | null> => {
  if (cachedVapidKey) return cachedVapidKey;
  try {
    const { data } = await supabase.functions.invoke('send-push-notification', {
      body: { action: 'get_public_key' },
    });
    if (data?.publicKey) {
      cachedVapidKey = data.publicKey;
      return data.publicKey;
    }
  } catch (e) {
    console.error('[push] Failed to fetch VAPID key', e);
  }
  return null;
};

export const usePushNotifications = () => {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSupported, setIsSupported] = useState(false);
  const [isIOS] = useState(isIOSDevice());
  const [isPWAInstalled] = useState(isStandalone());
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    const supported =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setIsSupported(supported);
    if (supported) {
      setPermission(Notification.permission);
    }
  }, []);

  // Register service worker
  const registerServiceWorker = useCallback(async (): Promise<ServiceWorkerRegistration | null> => {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      return registration;
    } catch (e) {
      console.error('[push] SW registration failed', e);
      return null;
    }
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;
    if (isIOS && !isPWAInstalled) return false;

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return false;

      const registration = await registerServiceWorker();
      if (!registration) return false;

      const vapidKey = await fetchVapidKey();
      if (!vapidKey) {
        console.error('[push] No VAPID key available');
        return false;
      }

      const existing = await registration.pushManager.getSubscription();
      const keyBytes = urlBase64ToUint8Array(vapidKey);
      // Cast to BufferSource — Uint8Array is a valid BufferSource at runtime,
      // but TS lib types are overly strict about ArrayBuffer vs SharedArrayBuffer.
      const sub =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes as unknown as BufferSource,
        }));

      const json = sub.toJSON();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: user.id,
          endpoint: sub.endpoint,
          p256dh_key: json.keys?.p256dh || '',
          auth_key: json.keys?.auth || '',
          user_agent: navigator.userAgent,
          device_type: isIOS ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop',
          is_active: true,
          last_used_at: new Date().toISOString(),
        },
        // One subscription per device per business; the business is recorded by the database from
        // the business the person is working in.
        { onConflict: 'user_id,endpoint,tenant_id' }
      );

      if (error) {
        console.error('[push] Failed to save subscription', error);
        return false;
      }

      // Ensure preferences row exists
      await supabase.from('push_notification_preferences').upsert(
        { user_id: user.id, push_enabled: true },
        { onConflict: 'user_id' }
      );

      setIsSubscribed(true);
      return true;
    } catch (e) {
      console.error('[push] Subscribe failed', e);
      return false;
    }
  }, [isSupported, isIOS, isPWAInstalled, registerServiceWorker]);

  const dismissPrompt = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('push_notification_preferences').upsert(
      {
        user_id: user.id,
        prompt_dismissed_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  }, []);

  const shouldShowPrompt = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;
    if (permission === 'granted' || permission === 'denied') return false;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data } = await supabase
      .from('push_notification_preferences')
      .select('prompt_dismissed_at')
      .eq('user_id', user.id)
      .maybeSingle();

    // Show if never dismissed, or dismissed more than 7 days ago
    if (!data?.prompt_dismissed_at) return true;
    const dismissedAt = new Date(data.prompt_dismissed_at).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt > sevenDays;
  }, [isSupported, permission]);

  return {
    isSupported,
    isIOS,
    isPWAInstalled,
    permission,
    isSubscribed,
    subscribe,
    dismissPrompt,
    shouldShowPrompt,
    registerServiceWorker,
  };
};
