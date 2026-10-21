import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

/** A failed load. It says so and offers a retry: an error is never shown as "no records". */
export function LoadError({ what, retryHref }: { what: string; retryHref?: string }) {
  return (
    <Alert variant="destructive">
      Could not load {what}. This is a problem loading the information, not an empty list.{" "}
      {retryHref ? <Link href={retryHref} className="font-medium underline underline-offset-2">Try again</Link> : "Reload the page; if it keeps happening, tell an administrator."}
    </Alert>
  );
}

/** What a list shows while it loads (also used as the route's loading state). */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="space-y-2 rounded-md border border-border p-3">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    </div>
  );
}
