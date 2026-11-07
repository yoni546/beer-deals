import app from "../../../../android/app.json";

/**
 * Digital Asset Links: Android's proof that the Google Play app (android/app.json) and this site belong to
 * the same people, which is what lets the app show the site full-screen with no browser bar. It lists the
 * SHA-256 fingerprints of the keys the app is signed with — the upload key and Google's Play App Signing
 * key. Fingerprints are public by design; the keys themselves never leave their owner and GitHub's secrets.
 *
 * Static, outside the session middleware (src/middleware.ts), and served as JSON at the exact path Android
 * asks for: https://beer-deals.vercel.app/.well-known/assetlinks.json
 */
export const dynamic = "force-static";

export function GET() {
  const statements = app.certSha256.length
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: { namespace: "android_app", package_name: app.packageId, sha256_cert_fingerprints: app.certSha256 },
        },
      ]
    : [];
  return Response.json(statements, { headers: { "cache-control": "public, max-age=3600" } });
}
