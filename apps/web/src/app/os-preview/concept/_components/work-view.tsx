"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Board, type BoardItem } from "@/components/workspace/board";
import { InlineSelect } from "@/components/workspace/inline-edit";
import { PanelLink } from "@/components/workspace/panel-link";
import { MoreDetails } from "@/components/workspace/quick-add";
import { Modal } from "@/components/ui/modal";
import { ViewSwitch } from "@/components/workspace/view-switch";
import { parseView, withParams } from "@/components/workspace/url-state";
import { PEOPLE, TASK_STATUSES, TIMELINE, TODAY, fmtDay, personFirst, personName, type Project, type Task, type TaskStatus, type TeamId } from "../_lib/sample";
import { canAddTask, canAssign, canEditStatus, filterTasks, isOverdue, readTaskFilter, sortTasks, statusChoices, statusRefusal } from "../_lib/logic";
import { useConcept } from "../_lib/store";
import { useUrlSearch } from "../_lib/use-url-search";
import { AttentionNote, EmptyNote, TaskStatusBadge, Badge } from "./bits";

const ASSIGNEES = [{ value: "", label: "Unassigned" }, ...PEOPLE.filter((p) => p.id !== "mina").map((p) => ({ value: p.id, label: p.name }))];
const milestoneOf = (t: Task) => TIMELINE.find((m) => m.id === t.milestoneId)?.title ?? null;

export function WorkView({ project, tasks, here }: { project: Project; tasks: Task[]; here: string }) {
  const { persona, setStatus, setAssignee } = useConcept();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = parseView(sp.get("view") ?? "");
  const f = readTaskFilter(sp);
  const [q, setQ] = useUrlSearch("q");
  const [moreFilters, setMoreFilters] = useState(false);
  const openId = sp.get("task");
  const rows = sortTasks(filterTasks(tasks, f, persona));
  const patch = (p: Record<string, string | null>) => router.replace(withParams(pathname, sp, p), { scroll: false });
  const clear = withParams(pathname, sp, {}, ["q", "who", "status", "show"]);
  const filtered = !!(f.q || f.who || f.status || f.show);
  const taskHref = (id: string) => withParams(pathname, sp, { task: id, ms: null, eq: null });

  const saveStatus = async (t: Task, next: string) => {
    const refusal = statusRefusal(persona, t, next as TaskStatus);
    if (refusal) return { error: refusal };
    return { error: (await setStatus(t.id, next as TaskStatus)) ? null : "Not saved. Your change was not kept." };
  };
  const saveAssignee = async (t: Task, next: string) => ({ error: (await setAssignee(t.id, next || null)) ? null : "Not saved. Your change was not kept." });

  const items: BoardItem[] = rows.map((t) => ({
    id: t.id, columnId: t.status, title: t.title,
    moveTo: canEditStatus(persona, t) ? statusChoices(persona, t).filter((c) => c.value !== t.status && !c.disabled).map((c) => c.value) : [],
    card: (
      <div className="min-w-0 text-sm">
        <PanelLink href={taskHref(t.id)} className="block break-words font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{t.title}</PanelLink>
        <p className="mt-1 text-muted-foreground">{personFirst(t.assignee)} · {fmtDay(t.due)}{isOverdue(t.due, t.status === "done") ? " · overdue" : ""}</p>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {t.blocked ? <AttentionNote tone="warn">Blocked</AttentionNote> : null}
          {t.status === "review" ? <AttentionNote tone="info">Waiting for review</AttentionNote> : null}
          {!t.assignee ? <AttentionNote tone="info">Needs an owner</AttentionNote> : null}
          {t.tag ? <Badge tone="blue">Client feedback</Badge> : null}
        </div>
      </div>
    ),
  }));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5" role="search" aria-label="Find tasks">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-56 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks by title, person or team" className="h-10 pl-9" />
        </div>
        <div role="group" aria-label="Show" className="inline-flex gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5">
          {([["", "All"], ["mine", "Mine"], ["attention", "Needs attention"]] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={f.show === v} onClick={() => patch({ show: v || null })} className={`h-8 rounded-[5px] px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${f.show === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="h-10 sm:hidden" aria-expanded={moreFilters} onClick={() => setMoreFilters((v) => !v)}>Filters{f.who || f.status ? <span className="rounded-full bg-primary px-1.5 text-[12px] font-bold text-primary-foreground">{Number(!!f.who) + Number(!!f.status)}</span> : null}</Button>
        <div className={`${moreFilters ? "flex" : "hidden"} basis-full flex-wrap gap-2.5 sm:contents`}>
        <label className="sr-only" htmlFor="cx-who">Assignee</label>
        <Select id="cx-who" value={f.who} onChange={(e) => patch({ who: e.target.value || null })} className="h-10 w-auto min-w-36">
          <option value="">Anyone</option><option value="none">Unassigned</option>
          {PEOPLE.filter((p) => tasks.some((t) => t.assignee === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <label className="sr-only" htmlFor="cx-status">Status</label>
        <Select id="cx-status" value={f.status} onChange={(e) => patch({ status: e.target.value || null })} className="h-10 w-auto min-w-36">
          <option value="">Any status</option>{TASK_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <ViewSwitch current={view} tableHref={withParams(pathname, sp, { view: null })} boardHref={withParams(pathname, sp, { view: "board" })} />
          {canAddTask(persona) ? <AddTask project={project} here={here} /> : null}
        </div>
      </div>

      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {rows.length} of {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        {filtered ? <> · <Link href={clear} scroll={false} className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">Clear filters</Link></> : null}
      </p>

      <div className="mt-3">
        {tasks.length === 0 ? (
          <EmptyNote title="No tasks in this sample project">Only some sample projects carry tasks. Open Aurora Pavilion or the Showroom project to see a full workspace.</EmptyNote>
        ) : rows.length === 0 ? (
          <EmptyNote title="No tasks match" action={<Link href={clear} scroll={false} className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Clear filters</Link>}>Try a different search or filter.</EmptyNote>
        ) : view === "board" ? (
          <div>
            <h2 className="sr-only">Tasks by status</h2>
            <p className="mb-2 text-sm text-muted-foreground">The same tasks, by status. Use “Move to” on a card (or drag it) to change its status. Only the person doing a task, or a manager, can move it.</p>
            <Board columns={TASK_STATUSES.map((s) => ({ id: s.id, label: s.label }))} items={items} ariaLabel="Tasks by status" emptyColumnText="No tasks"
              onMove={async (item, to) => {
                const t = tasks.find((x) => x.id === item.id)!;
                const refusal = statusRefusal(persona, t, to as TaskStatus);
                if (refusal) return { kind: "error", message: refusal };
                return (await setStatus(t.id, to as TaskStatus)) ? { kind: "done" } : { kind: "error", message: "Not saved. The card stays where it was." };
              }} />
          </div>
        ) : (
          <>
            <div className="hidden overflow-clip rounded-lg bg-card lg:block">
              <table className="cx-table">
                <caption className="sr-only">Tasks</caption>
                <colgroup><col style={{ width: "30%" }} /><col style={{ width: "16%" }} /><col style={{ width: "16%" }} /><col style={{ width: "18%" }} /><col style={{ width: "20%" }} /></colgroup>
                <thead><tr><th scope="col">Task</th><th scope="col">Assignee</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Blocker</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} data-selected={openId === t.id} className="cursor-pointer" onClick={(e) => { if ((e.target as HTMLElement).closest("a,select,button,label")) return; router.push(taskHref(t.id), { scroll: false }); }}>
                      <td>
                        <PanelLink href={taskHref(t.id)} className="cx-trunc rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span title={t.title}>{t.title}</span></PanelLink>
                        <span className="cx-trunc text-[13px] text-muted-foreground">{[milestoneOf(t), t.createdLocally ? "Added in this concept" : null, t.tag].filter(Boolean).join(" · ") || t.team}</span>
                      </td>
                      <td>{canAssign(persona, t) ? <InlineSelect value={t.assignee ?? ""} options={ASSIGNEES} label={`Assignee of ${t.title}`} onSave={(n) => saveAssignee(t, n)} /> : <span className="cx-trunc">{personName(t.assignee)}</span>}</td>
                      <td>{canEditStatus(persona, t) ? <InlineSelect value={t.status} options={statusChoices(persona, t)} label={`Status of ${t.title}`} onSave={(n) => saveStatus(t, n)} /> : <TaskStatusBadge status={t.status} />}</td>
                      <td><DueCell t={t} /></td>
                      <td><BlockerCell t={t} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-2.5 lg:hidden" aria-label="Tasks">
              {rows.map((t) => (
                <li key={t.id} className="rounded-lg bg-card p-4">
                  <PanelLink href={taskHref(t.id)} className="block break-words text-base font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{t.title}</PanelLink>
                  <p className="mt-1 text-sm text-muted-foreground">{personName(t.assignee)} · <DueCell t={t} inline /></p>
                  <div className="mt-2"><BlockerCell t={t} /></div>
                  <div className="mt-3">{canEditStatus(persona, t) ? <InlineSelect value={t.status} options={statusChoices(persona, t)} label={`Status of ${t.title}`} onSave={(n) => saveStatus(t, n)} /> : <TaskStatusBadge status={t.status} />}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function DueCell({ t, inline }: { t: Task; inline?: boolean }) {
  const late = isOverdue(t.due, t.status === "done");
  return <span className={`${inline ? "" : "block"} ${late ? "font-semibold text-[hsl(var(--cx-amber))]" : ""}`}>{fmtDay(t.due)}{late ? " · overdue" : ""}{t.due === TODAY ? " · today" : ""}</span>;
}
function BlockerCell({ t }: { t: Task }) {
  if (t.blocked && t.status !== "done") return <span title={t.blocked.reason} className="block min-w-0"><AttentionNote tone="warn">{t.blocked.reason}</AttentionNote></span>;
  if (t.status === "review") return <AttentionNote tone="info">Waiting for review</AttentionNote>;
  if (!t.assignee && t.status !== "done") return <AttentionNote tone="info">Needs an owner</AttentionNote>;
  return <span className="text-muted-foreground">None</span>;
}

function AddTask({ project, here }: { project: Project; here: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Add task</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add task" description="Sample only: the task stays in this browser tab.">
        <AddTaskForm project={project} here={here} close={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function AddTaskForm({ project, here, close }: { project: Project; here: string; close: () => void }) {
  const { addTask, href } = useConcept();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("2026-10-28");
  const [team, setTeam] = useState<TeamId>("Programming");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError("Give the task a short title."); return; }
    setBusy(true); setError(null);
    const who = assignee || null;
    const id = await addTask({ projectId: project.id, title: title.trim(), assignee: who, due, team: PEOPLE.find((p) => p.id === who)?.team ?? team, description: description.trim() });
    if (id) { close(); router.push(href(here, { tab: null, task: id }), { scroll: false }); }
    else { setBusy(false); setError("The task was not saved. Nothing was added."); }
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="cx-new-title" className="mb-1 block text-sm font-medium">Title</label>
        <Input id="cx-new-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={error && !title.trim() ? true : undefined} aria-describedby={error ? "cx-new-err" : undefined} />
        {error ? <p id="cx-new-err" role="alert" className="mt-1 text-sm text-destructive">{error}</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="cx-new-who" className="mb-1 block text-sm font-medium">Assignee</label><Select id="cx-new-who" value={assignee} onChange={(e) => setAssignee(e.target.value)}>{ASSIGNEES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</Select></div>
        <div><label htmlFor="cx-new-due" className="mb-1 block text-sm font-medium">Due</label><Input id="cx-new-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      <MoreDetails>
        <div><label htmlFor="cx-new-team" className="mb-1 block text-sm font-medium">Team</label><Select id="cx-new-team" value={assignee ? PEOPLE.find((p) => p.id === assignee)?.team ?? team : team} disabled={!!assignee} onChange={(e) => setTeam(e.target.value as TeamId)}><option>Programming</option><option>Content</option><option>Engineering</option></Select><p className="mt-1 text-[13px] text-muted-foreground">{assignee ? "Follows the assignee." : "Used while the task has no assignee."}</p></div>
        <div><label htmlFor="cx-new-desc" className="mb-1 block text-sm font-medium">Description</label><Textarea id="cx-new-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
      </MoreDetails>
      <div className="flex justify-end gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add task"}</Button></div>
    </form>
  );
}
