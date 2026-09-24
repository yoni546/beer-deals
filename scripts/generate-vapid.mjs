/**
 * Generates a VAPID key pair for Web Push.
 *
 * Run once, then paste the two values into .env.local (and into Vercel). The
 * private key never leaves the server; the public key is safe in the browser
 * bundle and is what the browser signs its subscription against.
 *
 * Changing these later invalidates every existing subscription — every user has
 * to turn notifications on again — so generate them once and keep them.
 *
 * Run: npm run vapid
 */

import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("");
console.log("Add these to .env.local (and to your hosting environment):");
console.log("");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY="${keys.publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${keys.privateKey}"`);
console.log('VAPID_SUBJECT="mailto:you@example.com"');
console.log("");
