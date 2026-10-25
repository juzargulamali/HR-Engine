import { Skeleton } from "@/components/ui/skeleton";

/** What any signed-in page shows while it loads (a page with its own loading.tsx shows that instead): a header and a card, never a blank screen. */
export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <div className="os-card space-y-3 p-4">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    </div>
  );
}
