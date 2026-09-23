import { NextResponse } from "next/server";

/**
 * TEMPORARY — added to diagnose which Supabase project the deployed app is
 * actually built against, after the Tokyo-to-Mumbai region migration. Does
 * not expose the anon key itself, only its final 6 characters (enough to
 * tell two keys apart) and the Supabase URL (already public, ships in every
 * page's client bundle anyway). Delete this route once the migration is
 * confirmed working.
 */
export async function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    anonKeyTail: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(-6) ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    deployedAt: new Date().toISOString(),
  });
}
