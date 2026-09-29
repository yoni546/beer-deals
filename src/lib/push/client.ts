import type { ActionResult } from "@/lib/actions/result";

/**
 * Browser-side notification logic, kept free of `window` so every branch can be
 * tested. The React component only wires real browser objects into these.
 *
 * Two rules the old toggle broke:
 *   1. What the switch SHOWS must be what is TRUE — permission granted, a real
 *      subscription on this device, and the user's own preference. A database
 *      default is not a subscription.
 *   2. Nothing the browser can refuse may crash the page. `subscribe()` throws
 *      in private windows, when push is blocked, and where FCM is unreachable;
 *      every one of those becomes a message the user can act on.
 */

export type PushState =
  | { kind: "unsupported" }
  | { kind: "blocked" }
  | { kind: "off" }
  | { kind: "on" };

export function derivePushState(input: {
  supported: boolean;
  permission: NotificationPermission;
  hasSubscription: boolean;
  /** The user's stored preference (profiles.notifications_enabled). */
  profileEnabled: boolean;
}): PushState {
  if (!input.supported) return { kind: "unsupported" };
  if (input.permission === "denied") return { kind: "blocked" };
  if (input.permission === "granted" && input.hasSubscription && input.profileEnabled) return { kind: "on" };
  return { kind: "off" };
}

/** VAPID keys travel as base64url; PushManager wants bytes. */
export function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export class TimeoutError extends Error {}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

type SubscriptionLike = {
  endpoint: string;
  toJSON(): { keys?: { p256dh?: string; auth?: string } };
  unsubscribe?: () => Promise<boolean>;
};

export type EnablePushDeps = {
  vapidPublicKey: string;
  userAgent: string;
  requestPermission: () => Promise<NotificationPermission>;
  subscribe: (applicationServerKey: ArrayBuffer) => Promise<SubscriptionLike>;
  saveSubscription: (subscription: { endpoint: string; p256dh: string; auth: string; userAgent: string }) => Promise<ActionResult>;
  setEnabled: (enabled: boolean) => Promise<ActionResult>;
  timeoutMs?: number;
};

export type PushOutcome = { ok: true } | { ok: false; message: string };

const MESSAGES = {
  denied: "ההתראות חסומות בדפדפן. אפשר לאשר אותן בהגדרות האתר ואז לנסות שוב.",
  dismissed: "לא אישרתם התראות בדפדפן, אז לא הפעלנו אותן.",
  notConfigured: "ההתראות עדיין לא מוגדרות בשרת.",
  subscribeRefused:
    "הדפדפן לא איפשר להירשם להתראות. במצב גלישה פרטי או כשההתראות חסומות זה לא יעבוד — נסו בחלון רגיל.",
  timeout: "ההרשמה להתראות לקחה יותר מדי זמן. נסו שוב.",
  noKeys: "לא הצלחנו להשלים את ההרשמה להתראות במכשיר הזה. נסו שוב.",
  save: "לא הצלחנו לשמור את ההרשמה להתראות. נסו שוב.",
} as const;

export async function enablePush(deps: EnablePushDeps): Promise<PushOutcome> {
  const timeoutMs = deps.timeoutMs ?? 20_000;

  let permission: NotificationPermission;
  try {
    permission = await deps.requestPermission();
  } catch {
    return { ok: false, message: MESSAGES.subscribeRefused };
  }
  if (permission === "denied") return { ok: false, message: MESSAGES.denied };
  if (permission !== "granted") return { ok: false, message: MESSAGES.dismissed };

  if (!deps.vapidPublicKey) return { ok: false, message: MESSAGES.notConfigured };

  let subscription: SubscriptionLike;
  try {
    subscription = await withTimeout(deps.subscribe(urlBase64ToBuffer(deps.vapidPublicKey)), timeoutMs);
  } catch (error) {
    return { ok: false, message: error instanceof TimeoutError ? MESSAGES.timeout : MESSAGES.subscribeRefused };
  }

  const keys = subscription.toJSON().keys;
  if (!subscription.endpoint || !keys?.p256dh || !keys?.auth) {
    await subscription.unsubscribe?.().catch(() => undefined);
    return { ok: false, message: MESSAGES.noKeys };
  }

  const saved = await deps
    .saveSubscription({ endpoint: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: deps.userAgent })
    .catch((): ActionResult => ({ ok: false, error: MESSAGES.save }));
  if (!saved.ok) {
    // Do not leave a browser subscription the server knows nothing about.
    await subscription.unsubscribe?.().catch(() => undefined);
    return { ok: false, message: saved.error || MESSAGES.save };
  }

  const flagged = await deps.setEnabled(true).catch((): ActionResult => ({ ok: false, error: MESSAGES.save }));
  if (!flagged.ok) return { ok: false, message: flagged.error || MESSAGES.save };

  return { ok: true };
}

export type DisablePushDeps = {
  getSubscription: () => Promise<SubscriptionLike | null>;
  deleteSubscription: (endpoint: string) => Promise<ActionResult>;
  setEnabled: (enabled: boolean) => Promise<ActionResult>;
};

export async function disablePush(deps: DisablePushDeps): Promise<PushOutcome> {
  // The preference goes first: once it is off the server will not push to this
  // person, even if removing the device subscription below fails.
  const flagged = await deps.setEnabled(false).catch((): ActionResult => ({ ok: false, error: MESSAGES.save }));
  if (!flagged.ok) return { ok: false, message: flagged.error || MESSAGES.save };

  try {
    const subscription = await deps.getSubscription();
    if (subscription) {
      await deps.deleteSubscription(subscription.endpoint);
      await subscription.unsubscribe?.();
    }
  } catch {
    // Best effort: the preference is already off, which is what stops the pushes.
  }
  return { ok: true };
}
