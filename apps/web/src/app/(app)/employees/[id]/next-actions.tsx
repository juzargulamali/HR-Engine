import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Exception } from "@/lib/hr/setup";

/** The short, actionable flags for this employee that the viewer can see, each linking to the exact tab or form. Renders nothing when there is nothing to do. */
export function NextActions({ exceptions }: { exceptions: readonly Exception[] }) {
  if (exceptions.length === 0) return null;
  return (
    <Card data-testid="next-actions">
      <CardHeader>
        <CardTitle className="text-base">Next actions</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {exceptions.map((x) => (
            <li key={x.key} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid={`next-action-${x.key}`}>
              <span className={cn("font-medium", x.tone === "attention" ? "text-warning" : "text-foreground")}>{x.label}</span>
              <Link href={x.href} className="text-accent hover:underline">
                Open
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
