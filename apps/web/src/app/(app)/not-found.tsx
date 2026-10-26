import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** A record or page that does not exist, or that this person may not open: the same calm card as every other state, inside the shell. */
export default function AppNotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div role="status" className="os-card flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground"><SearchX className="h-6 w-6" aria-hidden /></div>
        <h1 className="font-heading text-lg font-semibold">We couldn&apos;t find that</h1>
        <p className="text-sm text-muted-foreground">It may have been removed, the address may be wrong, or you may not have access to it.</p>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>Back to My Day</Link>
      </div>
    </div>
  );
}
