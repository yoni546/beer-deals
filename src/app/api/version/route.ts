import { NextResponse } from "next/server";
import packageJson from "../../../../package.json";
import { describeEnvironment } from "@/lib/environment";

/**
 * What is deployed here, for the deployment checks (scripts/smoke-production.mjs,
 * docs/PRODUCTION-HANDOFF-YONI.md): the release version, the Git commit Vercel built, the environment,
 * and which Supabase project the build talks to. All of it is already public (the Supabase address is in
 * every browser bundle); no key, no user data. Outside the middleware, so asking never creates a visitor.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return NextResponse.json(
    {
      version: packageJson.version,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      environment: describeEnvironment().name,
      supabaseRef: (url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/) ?? [])[1] ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
