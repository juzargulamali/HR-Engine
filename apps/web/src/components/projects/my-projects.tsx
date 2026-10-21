import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { dateText } from "@/lib/projects/format";

export interface MyProjectItem {
  id: string;
  name: string;
  reference: string;
  /** Only ever set for a project the person is a member of (or a founder for): milestones are member-only information. */
  nextMilestone: { title: string; due: string } | null;
  unread: number;
}

/**
 * The projects a person works on, each with its next milestone and a direct way into its discussion, on the page people land on.
 * It is what turns "find the next milestone" and "open the project discussion" into one click each, without making anyone walk
 * through the directory and the project's tabs first.
 */
export function MyProjects({ items }: { items: readonly MyProjectItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="My projects" className="rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold">My projects</h2>
      <ul className="divide-y divide-border">
        {items.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5">
            <div className="min-w-0">
              <Link href={`/projects/${p.id}`} className="break-words text-sm font-medium underline-offset-2 hover:underline">{p.name}</Link>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono text-[13px]">{p.reference}</span>
                {" · "}
                {p.nextMilestone ? <>Next milestone: <span className="text-foreground">{p.nextMilestone.title}</span>, {dateText(p.nextMilestone.due)}</> : "No dated milestone open"}
              </p>
            </div>
            <Link href={`/projects/${p.id}/discussion`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Discussion
              {p.unread > 0 ? <span className="rounded-full bg-accent px-1.5 text-[12px] font-semibold text-accent-foreground">{p.unread} new</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
