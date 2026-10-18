"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";

export interface JumpTask {
  id: string;
  title: string;
  open: boolean;
}

/**
 * From the discussion to the work it is about: choosing a task opens it in the Work section. It only navigates; nothing is created,
 * changed or copied, and a message is never turned into work by being sent.
 */
export function JumpToTask({ projectId, tasks }: { projectId: string; tasks: JumpTask[] }) {
  const router = useRouter();
  if (tasks.length === 0) return null;
  const open = tasks.filter((t) => t.open);
  const closed = tasks.filter((t) => !t.open);
  return (
    <div className="min-w-[14rem] max-w-sm flex-1">
      <label htmlFor="jump-task" className="sr-only">Jump to a task</label>
      <Select id="jump-task" value="" onChange={(e) => { if (e.target.value) router.push(`/projects/${projectId}/work?task=${e.target.value}`); }}>
        <option value="">Jump to a task…</option>
        {open.length > 0 ? <optgroup label="Open tasks">{open.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</optgroup> : null}
        {closed.length > 0 ? <optgroup label="Finished tasks">{closed.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</optgroup> : null}
      </Select>
    </div>
  );
}
