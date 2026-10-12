import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The dev-server build badge sits over the bottom tab bar on a phone-sized window and eats taps.
  devIndicators: false,
  // e2e builds go to their own folder so they never fight a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
  },
  async headers() {
    return [
      {
        // The service worker must never be cached, or users get stuck on an
        // old build until they clear site data.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // The bottle photo is the LCP element on every screen. These files are written
        // once per beer by scripts/prepare-bottle.mjs and never edited in place, so they
        // were being revalidated on every navigation for nothing.
        source: "/bottles/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/onboarding/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
