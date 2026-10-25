"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, Calendar, Check, ChevronDown, ChevronRight, ClipboardList, Eye, MessageSquare, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Board, type BoardItem } from "@/components/workspace/board";
import { PanelLink } from "@/components/workspace/panel-link";
import { MoreDetails } from "@/components/workspace/quick-add";
import { ViewSwitch } from "@/components/workspace/view-switch";
import { parseView, withParams } from "@/components/workspace/url-state";
import {
  PEOPLE, TASK_STATUSES, TIMELINE, TODAY, fmtDay, fmtShort, personFirst, personName,
  type Project, type Task, type TaskStatus, type TeamId, type TimelineItem,
} from "../_lib/sample";
import { canAddTask, canAssign, canEditStatus, filterTasks, isOverdue, readTaskFilter, sortTasks, statusRefusal, type NextAction } from "../_lib/logic";
import { useConcept } from "../_lib/store";
import { useUrlSearch } from "../_lib/use-url-search";
import { AttentionNote, Avatar, EmptyNote, STATUS, TaskStatusBadge, Badge } from "./bits";
import { ChoiceMenu, type Choice } from "./choice-menu";

const ASSIGNEES: Choice[] = [{ value: "", label: "Unassigned" }, ...PEOPLE.filter((p) => p.id !== "mina").map((p) => ({ value: p.id, label: p.name, avatar: p.name, short: p.name.split(" ")[0] }))];
const milestoneOf = (t: Task) => TIMELINE.find((m) => m.id === t.milestoneId)?.title ?? null;
const commentCount = (t: Task) => t.activity.filter((a) => a.kind === "comment").length;

/** The status choices for a task, with the reason beside any that cannot be chosen now. */
export function statusChoicesFor(persona: Parameters<typeof statusRefusal>[0], t: Task): Choice[] {
  return TASK_STATUSES.map((s) => {
    const refusal = s.id === t.status ? null : statusRefusal(persona, t, s.id);
    return { value: s.id, label: s.label, tone: STATUS[s.id].tone, disabled: !!refusal, hint: refusal ?? undefined };
  });
}

export function WorkView({ project, tasks, items, actions, here }: { project: Project; tasks: Task[]; items: TimelineItem[]; actions: NextAction[]; here: string }) {
  const { persona, setStatus, setAssignee } = useConcept();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = parseView(sp.get("view") ?? "");
  const f = readTaskFilter(sp);
  const [q, setQ] = useUrlSearch("q");
  const [searchOpen, setSearchOpen] = useState(!!f.q);
  const [filtersOpen, setFiltersOpen] = useState(!!(f.who || f.show === "mine" || (f.status && f.status !== "review")));
  const openId = sp.get("task");
  const rows = sortTasks(filterTasks(tasks, f, persona));
  const patch = (p: Record<string, string | null>) => router.replace(withParams(pathname, sp, p), { scroll: false });
  const clear = withParams(pathname, sp, {}, ["q", "who", "status", "show"]);
  const filtered = !!(f.q || f.who || f.status || f.show);
  const filterCount = Number(!!f.who) + Number(!!f.status) + Number(!!f.show);
  const taskHref = (id: string) => withParams(pathname, sp, { task: id, ms: null, eq: null });

  const saveStatus = async (t: Task, next: string) => {
    const refusal = statusRefusal(persona, t, next as TaskStatus);
    if (refusal) return { error: refusal };
    return { error: (await setStatus(t.id, next as TaskStatus)) ? null : "Not saved. Your change was not kept." };
  };
  const saveAssignee = async (t: Task, next: string) => ({ error: (await setAssignee(t.id, next || null)) ? null : "Not saved. Your change was not kept." });

  const open = tasks.filter((t) => t.status !== "done").length;
  const attention = filterTasks(tasks, { q: "", who: "", status: "", team: "", show: "attention" }, persona).length;
  const review = tasks.filter((t) => t.status === "review").length;
  const stats = [
    { key: "open", label: "Open tasks", n: open, Icon: ClipboardList, edge: "cyan", active: f.show === "open" && !f.status, set: { show: "open", status: null } },
    { key: "attention", label: "Need attention", n: attention, Icon: AlertTriangle, edge: "amber", active: f.show === "attention" && !f.status, set: { show: "attention", status: null } },
    { key: "review", label: "In review", n: review, Icon: Eye, edge: "blue", active: f.status === "review" && !f.show, set: { show: null, status: "review" } },
  ] as const;

  const boardItems: BoardItem[] = rows.map((t) => ({
    id: t.id, columnId: t.status, title: t.title,
    moveTo: canEditStatus(persona, t) ? TASK_STATUSES.filter((s) => s.id !== t.status && !statusRefusal(persona, t, s.id)).map((s) => s.id) : [],
    card: (
      <div className="min-w-0 text-sm">
        <PanelLink href={taskHref(t.id)} className="block break-words rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t.title}</PanelLink>
        <p className="mt-1.5 flex items-center gap-2 text-muted-foreground">{t.assignee ? <Avatar name={personName(t.assignee)} size="sm" /> : null}{personFirst(t.assignee)} · {fmtDay(t.due)}{isOverdue(t.due, t.status === "done") ? " · overdue" : ""}</p>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {t.blocked ? <AttentionNote tone="warn">Blocked</AttentionNote> : null}
          {t.status === "review" ? <AttentionNote tone="info">Waiting for review</AttentionNote> : null}
          {!t.assignee ? <AttentionNote tone="info">Needs an owner</AttentionNote> : null}
          {t.tag ? <Badge tone="blue">Client feedback</Badge> : null}
        </div>
      </div>
    ),
  }));

  const ownerCell = (t: Task) => canAssign(persona, t)
    ? <ChoiceMenu label="Assignee" value={t.assignee ?? ""} choices={ASSIGNEES} onSave={(n) => saveAssignee(t, n)} pill={false} />
    : <span className="inline-flex items-center gap-2">{t.assignee ? <Avatar name={personName(t.assignee)} size="sm" /> : null}<span className="cx-trunc" title={personName(t.assignee)}>{personFirst(t.assignee)}</span></span>;
  const statusCell = (t: Task) => canEditStatus(persona, t)
    ? <ChoiceMenu label="Status" value={t.status} choices={statusChoicesFor(persona, t).map((c) => (t.blocked && t.status !== "done" && c.value === t.status ? { ...c, label: "Blocked", tone: "red" as const } : c))} onSave={(n) => saveStatus(t, n)} />
    : <TaskStatusBadge status={t.status} blocked={!!t.blocked} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3" role="group" aria-label="Task summary">
        {stats.map(({ key, label, n, Icon, edge, active, set }) => (
          <Link key={key} href={active ? clear : withParams(pathname, sp, set)} scroll={false} aria-current={active ? "true" : undefined} className="cx-card cx-stat !flex-col !items-start !gap-1.5 !px-3.5 !py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:!flex-row sm:!items-center sm:!gap-3.5 sm:!px-4 sm:!py-4" data-edge={edge === "cyan" ? undefined : edge}>
            <Icon className={`h-5 w-5 flex-none sm:h-6 sm:w-6 ${edge === "amber" ? "text-[hsl(var(--cx-amber))]" : edge === "blue" ? "text-[hsl(var(--cx-info))]" : "text-accent"}`} aria-hidden />
            <span className="min-w-0 flex-1"><span className="block font-heading text-2xl font-semibold leading-none tabular-nums">{n}</span><span className="mt-1 block text-[13px] leading-tight text-muted-foreground sm:text-sm">{label}</span></span>
            <ChevronRight className="hidden h-4 w-4 flex-none text-muted-foreground sm:block" aria-hidden />
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="contents xl:flex xl:flex-col xl:gap-4">
          <section aria-label="Tasks" className="cx-card order-2 p-4 xl:order-none">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-heading text-lg font-semibold">Tasks</h2>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {rows.length} of {tasks.length}
                {filtered ? <> · <Link href={clear} scroll={false} className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Clear filters</Link></> : null}
              </p>
              <div className="ml-auto flex items-center gap-2">
                <ViewSwitch current={view} tableHref={withParams(pathname, sp, { view: null })} boardHref={withParams(pathname, sp, { view: "board" })} />
                <button type="button" aria-label="Search tasks" aria-expanded={searchOpen} onClick={() => setSearchOpen((v) => !v)} className={`inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${searchOpen || q ? "border-primary" : "border-transparent"}`}><Search className="h-4 w-4" aria-hidden /></button>
                <button type="button" aria-label={`Filters${filterCount ? `, ${filterCount} applied` : ""}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)} className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filtersOpen || filterCount ? "border-primary" : "border-transparent"}`}><SlidersHorizontal className="h-4 w-4" aria-hidden />{filterCount ? <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">{filterCount}</span> : null}</button>
              </div>
            </div>

            {searchOpen || q ? (
              <div className="relative mt-3 max-w-md" role="search">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input type="search" autoFocus={searchOpen && !q} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks by title, person or team" className="h-10 pl-9" />
              </div>
            ) : null}
            {filtersOpen ? (
              <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-xl bg-secondary/40 p-3">
                <div role="group" aria-label="Show" className="inline-flex gap-0.5 rounded-md border border-border bg-card p-0.5">
                  {([["", "All"], ["open", "Open"], ["mine", "Mine"], ["attention", "Needs attention"]] as const).map(([v, label]) => (
                    <button key={v} type="button" aria-pressed={f.show === v} onClick={() => patch({ show: v || null })} className={`h-8 rounded-[5px] px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${f.show === v ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
                  ))}
                </div>
                <label className="sr-only" htmlFor="cx-who">Assignee</label>
                <Select id="cx-who" value={f.who} onChange={(e) => patch({ who: e.target.value || null })} className="h-9 w-auto min-w-36">
                  <option value="">Anyone</option><option value="none">Unassigned</option>
                  {PEOPLE.filter((p) => tasks.some((t) => t.assignee === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <label className="sr-only" htmlFor="cx-status">Status</label>
                <Select id="cx-status" value={f.status} onChange={(e) => patch({ status: e.target.value || null })} className="h-9 w-auto min-w-36">
                  <option value="">Any status</option>{TASK_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
              </div>
            ) : null}

            <div className="mt-3">
              {tasks.length === 0 ? (
                <EmptyNote title="No tasks in this sample project">Only some sample projects carry tasks. Open Aurora Pavilion or the Showroom project to see a full workspace.</EmptyNote>
              ) : rows.length === 0 ? (
                <EmptyNote title="No tasks match" action={<Link href={clear} scroll={false} className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Clear filters</Link>}>Try a different search or filter.</EmptyNote>
              ) : view === "board" ? (
                <div>
                  <h3 className="sr-only">Tasks by status</h3>
                  <p className="mb-2 text-sm text-muted-foreground">The same tasks, by status. Use “Move to” on a card (or drag it) to change its status. Only the person doing a task, or a manager, can move it.</p>
                  <Board columns={TASK_STATUSES.map((s) => ({ id: s.id, label: s.label }))} items={boardItems} ariaLabel="Tasks by status" emptyColumnText="No tasks"
                    onMove={async (item, to) => {
                      const t = tasks.find((x) => x.id === item.id)!;
                      const refusal = statusRefusal(persona, t, to as TaskStatus);
                      if (refusal) return { kind: "error", message: refusal };
                      return (await setStatus(t.id, to as TaskStatus)) ? { kind: "done" } : { kind: "error", message: "Not saved. The card stays where it was." };
                    }} />
                </div>
              ) : (
                <>
                  <div className="hidden lg:block">
                    <table className="cx-table">
                      <caption className="sr-only">Tasks</caption>
                      <colgroup><col style={{ width: "36%" }} /><col style={{ width: "21%" }} /><col style={{ width: "19%" }} /><col style={{ width: "16%" }} /><col style={{ width: "8%" }} /></colgroup>
                      <thead><tr><th scope="col">Task</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col"><span className="sr-only">Comments</span></th></tr></thead>
                      <tbody>
                        {rows.map((t) => (
                          <tr key={t.id} data-selected={openId === t.id} className="cursor-pointer" onClick={(e) => { if ((e.target as HTMLElement).closest("a,select,button,label")) return; router.push(taskHref(t.id), { scroll: false }); }}>
                            <td>
                              <PanelLink href={taskHref(t.id)} className="cx-trunc rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span title={t.title}>{t.title}</span></PanelLink>
                              <span className={`cx-trunc text-[13px] ${t.blocked && t.status !== "done" ? "text-[hsl(var(--cx-amber))]" : "text-muted-foreground"}`} title={t.blocked?.reason}>
                                {t.blocked && t.status !== "done" ? `Blocked: ${t.blocked.reason}` : [milestoneOf(t), t.createdLocally ? "Added in this concept" : null, t.tag].filter(Boolean).join(" · ") || t.team}
                              </span>
                            </td>
                            <td>{ownerCell(t)}</td>
                            <td>{statusCell(t)}</td>
                            <td><DueCell t={t} /></td>
                            <td>{commentCount(t) ? <span className="inline-flex items-center gap-1 text-sm text-muted-foreground" title={`${commentCount(t)} comments`}><MessageSquare className="h-3.5 w-3.5" aria-hidden /><span aria-label={`${commentCount(t)} comments`}>{commentCount(t)}</span></span> : null}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="space-y-2.5 lg:hidden" aria-label="Tasks">
                    {rows.map((t) => (
                      <li key={t.id} className="rounded-xl border border-border bg-secondary/30 p-3.5">
                        <PanelLink href={taskHref(t.id)} className="block break-words rounded-sm text-base font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t.title}</PanelLink>
                        {t.blocked && t.status !== "done" ? <p className="mt-1 text-sm text-[hsl(var(--cx-amber))]">Blocked: {t.blocked.reason}</p> : null}
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                          {ownerCell(t)}{statusCell(t)}
                          <span className="ml-auto text-sm"><DueCell t={t} inline /></span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {canAddTask(persona) ? <div className="mt-2 border-t border-border/70 pt-2"><AddTask project={project} here={here} variant="row" /></div> : null}
          </section>

          <MilestoneStrip items={items} here={here} className="order-4 xl:order-none" />
        </div>

        <div className="contents xl:flex xl:flex-col xl:gap-4">
          <NextCard actions={actions} here={here} className="order-1 xl:order-none" />
          <SiteCard items={items} here={here} className="order-3 xl:order-none" />
          <ActivityCard tasks={tasks} className="order-5 xl:order-none" />
        </div>
      </div>
    </div>
  );
}

function DueCell({ t, inline }: { t: Task; inline?: boolean }) {
  const late = isOverdue(t.due, t.status === "done");
  const today = t.due === TODAY && t.status !== "done";
  const text = today ? "Today" : fmtDay(t.due);
  if (inline) return <span className={late || today ? "font-semibold text-[hsl(var(--cx-amber))]" : ""}>{text}{late ? " · overdue" : ""}</span>;
  return <span className={`block ${late || today ? "font-semibold text-[hsl(var(--cx-amber))]" : ""}`}>{text}{late ? <span className="block text-[13px] font-medium">Overdue</span> : null}</span>;
}

const HEAD: Record<string, string> = { b: "Blocked", r: "Waiting for you", u: "Needs an owner", e: "Needs your decision", o: "Overdue" };

function NextCard({ actions, here, className }: { actions: NextAction[]; here: string; className?: string }) {
  const { href } = useConcept();
  const [all, setAll] = useState(false);
  const first = actions[0];
  if (!first) return <section aria-label="Next action" className={`cx-card cx-cool p-4 ${className ?? ""}`}><p className="flex items-center gap-2 font-semibold"><Check className="h-4 w-4 text-accent" aria-hidden /> Nothing needs your attention</p><p className="mt-1 text-sm text-muted-foreground">Open tasks are on track for you.</p></section>;
  const go = (a: NextAction) => href(here, { tab: a.tab === "work" ? null : a.tab, task: a.taskId ?? null, ms: a.milestoneId ?? null, eq: null });
  const warm = /^[beo]/.test(first.id);
  return (
    <section aria-label="Next action" className={`cx-card p-4 ${warm ? "cx-warm" : ""} ${className ?? ""}`}>
      <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className={`h-4 w-4 ${warm ? "text-[hsl(var(--cx-amber))]" : "text-[hsl(var(--cx-info))]"}`} aria-hidden /> {HEAD[first.id[0]!] ?? "Next"}</p>
      <p className="mt-2 font-heading text-lg font-semibold leading-snug">{first.label}</p>
      <p className="mt-1 break-words text-sm text-muted-foreground">{first.detail}</p>
      <Link href={go(first)} scroll={false} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/60 bg-primary/10 px-3.5 text-sm font-medium hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {first.tab === "work" ? "Open task" : first.tab === "equipment" ? "Review equipment" : "Open timeline"} <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
      {actions.length > 1 ? (
        <div className="mt-2.5">
          <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="inline-flex items-center gap-1 rounded-md py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {all ? "Hide" : `${actions.length - 1} more to do`} <ChevronDown className={`h-4 w-4 transition-transform ${all ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {all ? (
            <ul className="mt-1 space-y-0.5 border-t border-border/60 pt-2">
              {actions.slice(1).map((a) => (
                <li key={a.id}><Link href={go(a)} scroll={false} className="block rounded-md px-2 py-1.5 text-sm hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="font-medium">{a.label}</span><span className="block break-words text-[13px] text-muted-foreground">{a.detail}</span></Link></li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ActivityCard({ tasks, className }: { tasks: Task[]; className?: string }) {
  const rank = (at: string) => { const m = /(\d{1,2}) (Oct|Nov)/.exec(at); return m ? Number(m[1]) + (m[2] === "Nov" ? 31 : 0) : 0; };
  const all = tasks.flatMap((t) => t.activity.map((a) => ({ a, t }))).map((x, i) => ({ ...x, i })).sort((x, y) => rank(y.a.at) - rank(x.a.at) || y.i - x.i).slice(0, 4);
  return (
    <section aria-label="Team activity" className={`cx-card p-4 ${className ?? ""}`}>
      <h2 className="font-heading text-lg font-semibold">Team activity</h2>
      {all.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No activity yet.</p> : (
        <ol className="mt-3 space-y-3.5">
          {all.map(({ a, t }) => (
            <li key={`${t.id}-${a.id}`} className="flex gap-3">
              <Avatar name={personName(a.who)} />
              <div className="min-w-0 text-sm">
                <p className="break-words"><span className="font-semibold">{personFirst(a.who)}</span> <span className="text-muted-foreground">{a.kind === "comment" ? `commented: “${a.text.length > 60 ? `${a.text.slice(0, 60)}…` : a.text}”` : a.text.charAt(0).toLowerCase() + a.text.slice(1)}</span></p>
                <p className="truncate text-[13px] text-muted-foreground">{t.title} · {a.at}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SiteCard({ items, here, className }: { items: TimelineItem[]; here: string; className?: string }) {
  const { href } = useConcept();
  const next = [...items].filter((i) => i.kind === "site" && i.date >= TODAY).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!next) return null;
  return (
    <section aria-label="Next on site" className={`cx-card cx-cool p-4 ${className ?? ""}`}>
      <p className="flex items-center gap-2 text-sm font-semibold"><Calendar className="h-4 w-4 text-accent" aria-hidden /> Next on site</p>
      <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{fmtShort(next.date)} · {next.startTime}</p>
      <p className="mt-0.5 font-medium">{next.title}</p>
      <p className="text-sm text-muted-foreground">{next.owner} · times in GST (Dubai, UTC+4)</p>
      <Link href={href(here, { tab: "timeline", ms: next.id })} scroll={false} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/60 bg-primary/10 px-3.5 text-sm font-medium hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View schedule <ArrowRight className="h-4 w-4" aria-hidden /></Link>
    </section>
  );
}

/** The next few milestones and deliverables in date order, from the project's own timeline. Nothing here is a progress figure. */
function MilestoneStrip({ items, here, className }: { items: TimelineItem[]; here: string; className?: string }) {
  const { href } = useConcept();
  const list = items.filter((i) => i.kind !== "site").sort((a, b) => a.date.localeCompare(b.date));
  if (list.length === 0) return null;
  const firstOpen = list.findIndex((i) => !i.done);
  const start = Math.max(0, (firstOpen === -1 ? list.length : firstOpen) - 1);
  const shown = list.slice(start, start + 5);
  const nextId = shown.find((i) => !i.done && i.date >= TODAY)?.id;
  const state = (i: TimelineItem) => (i.done ? "done" : i.date < TODAY ? "late" : i.id === nextId ? "next" : "todo");
  const link = (i: TimelineItem) => href(here, { tab: "timeline", ms: i.id });
  return (
    <section aria-label="Delivery milestones" className={`cx-card p-4 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold">Delivery milestones</h2>
        <Link href={href(here, { tab: "timeline" })} scroll={false} className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View all <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </div>
      <ol className="mt-4 hidden sm:flex">
        {shown.map((i, idx) => (
          <li key={i.id} className="cx-step">
            <div className="flex items-center">
              <Link href={link(i)} scroll={false} aria-label={`${i.title}, ${fmtShort(i.date)}${i.done ? ", done" : i.date < TODAY ? ", overdue" : ""}`} className="cx-node focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-state={state(i)}>{i.done ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}</Link>
              {idx < shown.length - 1 ? <span className="cx-rail mx-1" data-done={String(i.done)} aria-hidden /> : null}
            </div>
            <p className="mt-2 truncate pr-2 text-sm font-medium" title={i.title}>{i.title}</p>
            <p className={`text-[13px] ${state(i) === "late" ? "font-semibold text-[hsl(var(--cx-amber))]" : "text-muted-foreground"}`}>{fmtShort(i.date)}{state(i) === "late" ? " · overdue" : ""}</p>
          </li>
        ))}
      </ol>
      <ol className="mt-3 space-y-2.5 sm:hidden">
        {shown.map((i) => (
          <li key={i.id}>
            <Link href={link(i)} scroll={false} className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="cx-node flex-none" data-state={state(i)} aria-hidden>{i.done ? <Check className="h-3.5 w-3.5" /> : null}</span>
              <span className="min-w-0 text-sm"><span className="block truncate font-medium">{i.title}</span><span className={state(i) === "late" ? "font-semibold text-[hsl(var(--cx-amber))]" : "text-muted-foreground"}>{fmtShort(i.date)}{state(i) === "late" ? " · overdue" : i.done ? " · done" : ""}</span></span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function AddTask({ project, here, variant = "primary" }: { project: Project; here: string; variant?: "primary" | "row" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "primary"
        ? <Button type="button" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Add task</Button>
        : <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium text-accent hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus className="h-4 w-4" aria-hidden /> Add task</button>}
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
