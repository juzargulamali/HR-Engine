import { Skeleton } from "@/components/ui/skeleton";
import { ListSkeleton } from "@/components/workspace/states";

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading project">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <ListSkeleton rows={4} />
    </div>
  );
}
