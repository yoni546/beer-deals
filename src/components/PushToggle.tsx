"use client";

import { useEffect, useState, useTransition } from "react";
import { Notice } from "@/components/Chrome";
import { Tape } from "@/components/ui/Tape";
import { deletePushSubscription, savePushSubscription } from "@/lib/actions/push";
import { setNotificationsEnabled } from "@/lib/actions/profile";
import { derivePushState, disablePush, enablePush, withTimeout, type PushState } from "@/lib/push/client";

/**
 * The one notification switch.
 *
 * What it shows is derived from what is actually true on this device — browser
 * permission, a real push subscription, and the user's stored preference (see
 * derivePushState). It used to trust the stored preference alone, which
 * defaulted to "on", so people who had never been asked saw "active" and their
 * first tap switched notifications OFF.
 *
 * A browser permission, once denied, can only be changed in the browser's own
 * settings, so that state is named instead of leaving a switch that silently
 * does nothing. And nothing the browser refuses is allowed to crash the page:
 * failures come back from enablePush() as a message and are shown inline.
 */
export function PushToggle({
  vapidPublicKey,
  enabled,
  primaryBeerName,
}: {
  vapidPublicKey: string;
  enabled: boolean;
  primaryBeerName: string | null;
}) {
  const [state, setState] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        if (!cancelled) setState({ kind: "unsupported" });
        return;
      }

      let hasSubscription = false;
      try {
        // `ready` never resolves if the worker failed to register, hence the timeout.
        const registration = await withTimeout(navigator.serviceWorker.ready, 4000);
        hasSubscription = Boolean(await registration.pushManager.getSubscription());
      } catch {
        hasSubscription = false;
      }

      if (!cancelled) {
        setState(
          derivePushState({
            supported: true,
            permission: Notification.permission,
            hasSubscription,
            profileEnabled: enabled,
          }),
        );
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (state === null) return null;

  if (state.kind === "unsupported") {
    return (
      <Tape className="px-4 py-4">
        <p className="text-base font-bold text-ink">אי אפשר לקבל התראות בדפדפן הזה</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">באייפון צריך קודם להוסיף את האפליקציה למסך הבית, ואז להפעיל התראות משם.</p>
      </Tape>
    );
  }

  const on = state.kind === "on";
  const blocked = state.kind === "blocked";

  function toggle() {
    setError(null);
    startTransition(async () => {
      if (on) {
        const outcome = await disablePush({
          getSubscription: async () => {
            const registration = await navigator.serviceWorker.ready;
            return registration.pushManager.getSubscription();
          },
          deleteSubscription: deletePushSubscription,
          setEnabled: setNotificationsEnabled,
        });
        if (outcome.ok) setState({ kind: "off" });
        else setError(outcome.message);
        return;
      }

      const outcome = await enablePush({
        vapidPublicKey,
        userAgent: navigator.userAgent,
        requestPermission: () => Notification.requestPermission(),
        subscribe: async (applicationServerKey) => {
          const registration = await navigator.serviceWorker.ready;
          return registration.pushManager.subscribe({
            // Required by every browser that implements Web Push: a silent push
            // is not allowed, and asking for one fails the subscribe outright.
            userVisibleOnly: true,
            applicationServerKey,
          });
        },
        saveSubscription: savePushSubscription,
        setEnabled: setNotificationsEnabled,
      });

      if (outcome.ok) setState({ kind: "on" });
      else {
        setError(outcome.message);
        if (Notification.permission === "denied") setState({ kind: "blocked" });
      }
    });
  }

  return (
    <Tape className="px-4 py-3">
      <button
        type="button"
        disabled={pending || blocked}
        onClick={toggle}
        aria-pressed={on}
        className="flex min-h-14 w-full items-center gap-4 text-start disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-ink">{on ? "התראות פעילות" : "קבלו התראה על מבצע חזק"}</span>
          <span className="mt-0.5 block text-sm text-ink-2">
            {primaryBeerName ? `רק על ${primaryBeerName}, הבירה הראשית שלכם` : "רק על הבירה הראשית שלכם"}
          </span>
        </span>
        {/* A drawn switch. It says nothing the words don't: the position and the label agree. */}
        <span
          aria-hidden
          className={`relative h-8 w-14 shrink-0 rounded-full border-2 transition-colors ${on ? "border-deal bg-deal" : "border-ink-2 bg-transparent"}`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full transition-all ${on ? "end-0.5 bg-on-deal" : "start-0.5 bg-ink-2"}`}
          />
        </span>
      </button>

      {(blocked || error) && (
        <div className="space-y-2 pt-2 pb-1">
          {blocked && <Notice tone="info">ההתראות חסומות ברמת הדפדפן. צריך לאשר אותן בהגדרות האתר ואז לנסות שוב.</Notice>}
          {error && <Notice>{error}</Notice>}
        </div>
      )}
    </Tape>
  );
}
