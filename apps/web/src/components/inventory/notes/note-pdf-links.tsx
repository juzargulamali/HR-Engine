import { Download, Printer } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { notePdfHref } from "@/lib/inventory/project-notes";
import { cn } from "@/lib/utils";

/** Download and print links for one note. The PDF is made on demand from the note's frozen content under the caller's own access. */
export function NotePdfLinks({ projectId, noteId, noteNo, size = "sm", className }: { projectId: string; noteId: string; noteNo: string; size?: "sm" | "default"; className?: string }) {
  const href = notePdfHref(projectId, noteId);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <a href={href} download className={buttonVariants({ size, variant: "outline" })}><Download className="mr-1.5 h-4 w-4" aria-hidden />Download PDF<span className="sr-only"> of {noteNo}</span></a>
      <a href={href} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size, variant: "ghost" })}><Printer className="mr-1.5 h-4 w-4" aria-hidden />Open to print<span className="sr-only"> {noteNo}</span></a>
    </span>
  );
}
