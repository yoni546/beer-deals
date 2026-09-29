import "server-only";

import webpush from "web-push";
import { publicEnv, serverEnv } from "@/lib/env";
import type { PushSender } from "@/lib/push/worker";

let configured = false;

/**
 * The real Web Push transport, or null when the VAPID keys are not configured (in which case
 * nothing can be sent and callers should say so instead of pretending).
 */
export function createWebPushSender(): PushSender | null {
  const { vapidPrivateKey, vapidSubject } = serverEnv();
  if (!publicEnv.vapidPublicKey || !vapidPrivateKey) return null;
  if (!configured) {
    webpush.setVapidDetails(vapidSubject, publicEnv.vapidPublicKey, vapidPrivateKey);
    configured = true;
  }
  return async (target, payload, { ttlSeconds }) => {
    await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, { TTL: ttlSeconds });
  };
}
