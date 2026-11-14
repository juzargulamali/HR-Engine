import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import type { OutputLinkLine } from "@/lib/projects/my-work-outputs";

/** One line per output version behind the list below: what it is, whose turn it is, and a link that opens the task with THAT version in view. */
export function MyWorkOutputs({ title, lines, testId = "mywork-outputs" }: { title: string; lines: readonly OutputLinkLine[]; testId?: string }) {
  if (lines.length === 0) return null;
  return (
    <section aria-label={title} className="os-card px-4 py-3" data-testid={testId}>
      <h2 className="mb-1 flex items-center gap-2 font-heading text-base font-semibold"><FileCheck2 className="h-4 w-4 text-accent" aria-hidden /> {title} <span className="text-[13px] font-normal tabular-nums text-muted-foreground">({lines.length})</span></h2>
      <ul className="divide-y divide-border/70">
        {lines.map((l) => (
          <li key={l.versionId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm" data-testid={`mywork-output-${l.taskId}`}>
            <div className="min-w-0">
              <Link href={l.href} scroll={false} className="break-words font-medium underline-offset-4 hover:underline">{l.title}</Link>
              <p className="break-words text-[13px] text-muted-foreground">{l.context} · {l.text}</p>
            </div>
            <Link href={l.href} scroll={false} className="text-[13px] font-medium text-accent underline-offset-4 hover:underline">Open the version</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
