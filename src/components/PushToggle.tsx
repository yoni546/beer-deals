"use client";

import { useEffect, useState, useTransition } from "react";
import { deletePushSubscription, savePushSubscription } from "@/lib/actions/push";
import { setNotificationsEnabled } from "@/lib/actions/profile";

/** VAPID keys travel as base64url; PushManager wants an ArrayBuffer. */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

/**
 * The one notification switch.
 *
 * It does two things that must stay together: it asks the browser for
 * permission and stores the resulting endpoint, and it sets the user's
 * preference in the database. Only the second can be undone from here — a
 * browser permission, once denied, can only be changed in browser settings, so
 * that case is named explicitly instead of leaving a switch that silently does
 * nothing.
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
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const ok =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (ok) setPermission(Notification.permission);
  }, []);

  if (supported === null) return null;

  if (!supported) {
    return (
      <p className="text-sm opacity-60">
        הדפדפן הזה לא תומך בהתראות. באייפון צריך קודם להוסיף את האפליקציה למסך הבית.
      </p>
    );
  }

  async function turnOn() {
    setError(null);

    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") {
      setError("ההתראות חסומות בדפדפן. אפשר לאשר אותן בהגדרות האתר.");
      return;
    }

    if (!vapidPublicKey) {
      setError("ההתראות עדיין לא מוגדרות בשרת.");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      // Required by every browser that implements Web Push: a silent push is
      // not allowed, and asking for one fails the subscribe outright.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(vapidPublicKey),
    });

    const json = subscription.toJSON();
    const saved = await savePushSubscription({
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      userAgent: navigator.userAgent,
    });

    if (!saved.ok) {
      setError(saved.error);
      return;
    }

    await setNotificationsEnabled(true);
    setOn(true);
  }

  async function turnOff() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await deletePushSubscription(subscription.endpoint);
      await subscription.unsubscribe();
    }
    await setNotificationsEnabled(false);
    setOn(false);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => (on ? turnOff() : turnOn()))}
        className={[
          "flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-right transition",
          on
            ? "bg-[color:var(--accent)] text-[color:var(--base)]"
            : "bg-[color:var(--surface)] ring-1 ring-white/10",
        ].join(" ")}
      >
        <span>
          <span className="block text-sm font-bold">
            {on ? "התראות פעילות" : "קבלו התראה על מבצע חזק"}
          </span>
          <span className="block text-xs opacity-70">
            {primaryBeerName
              ? `רק על ${primaryBeerName} — הבירה הראשית שלכם`
              : "רק על הבירה הראשית שלכם"}
          </span>
        </span>
        <span aria-hidden className="text-xl">
          {on ? "🔔" : "🔕"}
        </span>
      </button>

      {permission === "denied" && (
        <p className="text-xs opacity-60">
          ההתראות חסומות ברמת הדפדפן. צריך לאשר אותן בהגדרות האתר ואז לנסות שוב.
        </p>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
