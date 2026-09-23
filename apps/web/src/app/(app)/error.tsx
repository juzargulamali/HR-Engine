"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Segment-level error boundary for every authenticated page — catches an
 * uncaught Server Component render error (or any error thrown during this
 * segment's render/hydration) so it replaces just the page content, never
 * the whole browser tab with a blank crash. Next.js requires this to be a
 * Client Component; `error.digest` is the correlation ID Next.js already
 * attaches server-side (Vercel's function logs are searchable by it) — the
 * server's own logServerError() call at the actual failure point is the
 * real diagnostic record, this is just enough for a user to reference it.
 */
export default function AppSegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dashboard-error]", {
      digest: error.digest,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="h-6 w-6" aria-hidden />
      </div>
      <div className="space-y-1.5">
        <h1 className="font-heading text-lg font-semibold">This page couldn&apos;t load</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Something went wrong loading this page. Your data is safe — try again, and if it keeps happening, share the reference below with
          support.
        </p>
      </div>
      {error.digest ? (
        <p className="rounded-md border border-border bg-secondary/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
      <Button type="button" onClick={reset}>
        <RotateCcw className="h-4 w-4" aria-hidden />
        Try again
      </Button>
    </div>
  );
}
