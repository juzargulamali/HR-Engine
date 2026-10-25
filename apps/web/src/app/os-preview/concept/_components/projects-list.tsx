"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Board, type BoardItem } from "@/components/workspace/board";
import { ViewSwitch } from "@/components/workspace/view-switch";
import { parseView, withParams } from "@/components/workspace/url-state";
import { PROJECTS, STAGES, fmtDay, pmName, stageLabel, tasksOf, timelineOf, type Project } from "../_lib/sample";
import { attentionOf, attentionSummary, filterProjects, readProjectFilter, sortProjects, visibleProjects, isOverdue } from "../_lib/logic";
import { useConcept } from "../_lib/store";
import { useUrlSearch } from "../_lib/use-url-search";
import { AttentionNote, Badge, EmptyNote, LoadError, Notice, SkeletonRows, StageBadge } from "./bits";

const BASE = "/os-preview/concept";
const PMS = ["layla", "hamza", "karim"];

export function ProjectsWorkspace() {
  const { persona, tasks, lines, href, getListMemory, rememberList, lastOpened, forced, setForced } = useConcept();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const summaryOnly = persona.kind === "directory";
  const view = parseView(sp.get("view") ?? "");
  const f = readProjectFilter(sp);
  const fid = useId();
  const [adding, setAdding] = useState(false);
  const [panel, setPanel] = useState(false);
  const [q, setQ] = useUrlSearch("q");

  // Coming back from a project: same filters (they are in the address), same view, same place on the page.
  useEffect(() => {
    const m = getListMemory();
    if (m.scroll > 0) requestAnimationFrame(() => window.scrollTo(0, m.scroll));
    rememberList({ ...m, scroll: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the list appears
  }, []);

  const attentionFor = (p: Project) => attentionOf(p, tasksOf(p.id).length ? tasks.filter((t) => t.projectId === p.id) : [], timelineOf(p.id), lines.filter((l) => l.projectId === p.id));
  const mine = useMemo(() => visibleProjects(persona, PROJECTS), [persona]);
  const spKey = sp.toString();
  const rows = useMemo(
    () => sortProjects(filterProjects(mine, readProjectFilter(new URLSearchParams(spKey)), (p) => attentionFor(p).length)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `attentionFor` only reads `tasks` and `lines`, listed here
    [mine, spKey, tasks, lines],
  );

  const patch = (p: Record<string, string | null>) => router.replace(withParams(pathname, sp, p), { scroll: false });
  const active = [f.stage && `Stage: ${stageLabel(f.stage as never)}`, f.pm && `Manager: ${pmName(f.pm)}`, f.attention && "Needs attention", f.kind && (f.kind === "internal" ? "Internal" : "Client"), f.company && (f.company === "ksa" ? "KSA" : "UAE"), f.show && (f.show === "completed" ? "Completed only" : "All, including completed")].filter(Boolean) as string[];
  const clearHref = withParams(pathname, sp, {}, ["q", "stage", "pm", "attn", "kind", "company", "show"]);
  const companyName = persona.companies.length === 1 ? mine[0]?.companyName : null;

  const remember = (id: string) => rememberList({ query: spKey, scroll: window.scrollY, last: id });
  const open = (p: Project) => href(`${BASE}/${p.id}`);

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 pb-24 pt-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {forced === "none" ? `${rows.length} ${rows.length === 1 ? "project" : "projects"}` : "Loading…"}{companyName ? ` · ${companyName}` : persona.companies.length > 1 ? " · Both companies" : ""}
          </p>
        </div>
        {!summaryOnly ? <Button type="button" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add project</Button> : null}
      </div>

      {summaryOnly ? (
        <div className="mt-4">
          <Notice title="Summary view">You can see which projects exist, who manages them and what stage they are in. Milestones, tasks and equipment are for the people working on a project.</Notice>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2.5" role="search" aria-label="Find projects">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-64 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects by reference, name, client or manager" className="h-10 pl-9" />
        </div>
        <div className="hidden items-center gap-2.5 md:flex">{primaryFilters()}</div>
        <Button type="button" variant="outline" aria-expanded={panel} onClick={() => setPanel((o) => !o)} className="h-10">
          <Filter className="h-4 w-4" aria-hidden /> <span className="md:hidden">Filters</span><span className="hidden md:inline">More filters</span>{active.length ? <span className="rounded-full bg-primary px-1.5 text-[12px] font-bold text-primary-foreground">{active.length}</span> : null}
        </Button>
        <div className="ml-auto">
          <ViewSwitch current={view} tableHref={withParams(pathname, sp, { view: null })} boardHref={withParams(pathname, sp, { view: "board" })} />
        </div>
      </div>

      {panel ? (
        <div className="mt-3 rounded-lg bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-3 sm:contents md:hidden">{primaryFilters(true)}</div>
            <Field label="Client or internal">
              <Select value={f.kind} onChange={(e) => patch({ kind: e.target.value || null })}><option value="">Both</option><option value="client">Client projects</option><option value="internal">Internal projects</option></Select>
            </Field>
            {persona.companies.length > 1 ? (
              <Field label="Company"><Select value={f.company} onChange={(e) => patch({ company: e.target.value || null })}><option value="">All companies</option><option value="uae">Enginious Dubai</option><option value="ksa">Enginious KSA</option></Select></Field>
            ) : null}
            <Field label="Completed projects">
              <Select value={f.show} onChange={(e) => patch({ show: e.target.value || null })}><option value="">Hide completed</option><option value="completed">Only completed</option><option value="all">Show all</option></Select>
            </Field>
          </div>
        </div>
      ) : null}

      {active.length > 0 || q ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {active.map((a) => <Badge key={a} tone="cyan">{a}</Badge>)}
          <Link href={clearHref} scroll={false} className="rounded-md px-2 py-1 text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Clear filters</Link>
        </div>
      ) : null}

      <div className="mt-4">
        {forced === "loading" ? <SkeletonRows label="Loading projects" /> : forced === "error" ? <LoadError what="Projects" onRetry={() => setForced("none")} /> : rows.length === 0 ? (
          <EmptyNote title="No projects match" action={<Link href={clearHref} scroll={false} className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Clear filters</Link>}>
            Try a shorter search, or clear the filters. Completed projects are hidden unless you choose them.
          </EmptyNote>
        ) : view === "board" ? (
          <ProjectBoard rows={rows} summaryOnly={summaryOnly} open={open} remember={remember} attentionFor={attentionFor} showCompleted={f.show !== ""} />
        ) : (
          <>
            <ProjectTable rows={rows} summaryOnly={summaryOnly} open={open} remember={remember} attentionFor={attentionFor} last={lastOpened} />
            <ProjectCards rows={rows} summaryOnly={summaryOnly} open={open} remember={remember} attentionFor={attentionFor} />
          </>
        )}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add project" description="Not part of this concept">
        <p className="text-sm text-muted-foreground">In the live app a project starts from an accepted enquiry, or from the internal-project form. This concept only shows how the Projects list and a project are laid out, so creating a project stays in the live app.</p>
        <div className="mt-4 flex justify-end"><Button type="button" variant="outline" onClick={() => setAdding(false)}>Close</Button></div>
      </Modal>
    </div>
  );

  function primaryFilters(stacked?: boolean) {
    const id = fid;
    const sel = (key: string, label: string, value: string, options: [string, string][]) => (
      stacked ? (
        <Field label={label}><Select value={value} onChange={(e) => patch({ [key]: e.target.value || null })}><option value="">{`Any ${label.toLowerCase()}`}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      ) : (
        <>
          <label htmlFor={`${id}-${key}`} className="sr-only">{label}</label>
          <Select id={`${id}-${key}`} value={value} onChange={(e) => patch({ [key]: e.target.value || null })} className="h-10 w-auto min-w-36">
            <option value="">{label === "Stage" ? "All stages" : "All managers"}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </>
      )
    );
    return (
      <>
        {sel("stage", "Stage", f.stage, STAGES.filter((s) => s.id !== "completed").map((s) => [s.id, s.label]))}
        {sel("pm", "Manager", f.pm, PMS.filter((id) => mine.some((p) => p.pm === id)).map((id) => [id, pmName(id)]))}
        <label className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium ${f.attention ? "border-primary bg-primary/10" : "border-input"} ${stacked ? "w-full sm:col-span-2" : ""}`}>
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={f.attention === "1"} onChange={(e) => patch({ attn: e.target.checked ? "1" : null })} disabled={summaryOnly} />
          Needs attention
        </label>
      </>
    );
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-muted-foreground">{label}</span>{children}</label>;
}

interface ListProps { rows: Project[]; summaryOnly: boolean; open: (p: Project) => string; remember: (id: string) => void; attentionFor: (p: Project) => ReturnType<typeof attentionOf> }

function ClientCell({ p }: { p: Project }) {
  return p.kind === "internal" ? <Badge tone="blue">Internal</Badge> : <span className="cx-trunc" title={p.client ?? ""}>{p.client}</span>;
}
function NextCell({ p }: { p: Project }) {
  if (!p.nextMilestone) return <span className="text-muted-foreground">None set</span>;
  const late = isOverdue(p.nextMilestone.due, false);
  return (
    <div className="min-w-0">
      <span className="cx-trunc" title={p.nextMilestone.title}>{p.nextMilestone.title}</span>
      <span className={`text-[13px] ${late ? "font-semibold text-[hsl(var(--cx-amber))]" : "text-muted-foreground"}`}>{fmtDay(p.nextMilestone.due)}{late ? " · overdue" : ""}</span>
    </div>
  );
}
function AttentionCell({ notes }: { notes: ReturnType<typeof attentionOf> }) {
  if (notes.length === 0) return <span className="text-muted-foreground">Nothing needed</span>;
  const words = attentionSummary(notes);
  const worst = notes.some((n) => n.tone === "bad") ? "bad" : notes.some((n) => n.tone === "warn") ? "warn" : "info";
  return (
    <div className="min-w-0" title={words.join(", ")}>
      <AttentionNote tone={worst}>{words[0]}</AttentionNote>
      {words.length > 1 ? <span className="block pl-5 text-[13px] text-muted-foreground">+{words.length - 1} more</span> : null}
    </div>
  );
}

const nameLink = "font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

function ProjectTable({ rows, summaryOnly, open, remember, attentionFor, last }: ListProps & { last: string }) {
  const router = useRouter();
  return (
    <div className="hidden overflow-clip rounded-lg bg-card lg:block">
      <table className="cx-table">
        <caption className="sr-only">Projects</caption>
        <colgroup>
          <col style={{ width: summaryOnly ? "40%" : "27%" }} /><col style={{ width: summaryOnly ? "22%" : "15%" }} /><col style={{ width: summaryOnly ? "20%" : "11%" }} /><col style={{ width: summaryOnly ? "18%" : "17%" }} />
          {summaryOnly ? null : <><col style={{ width: "15%" }} /><col style={{ width: "15%" }} /></>}
        </colgroup>
        <thead><tr><th scope="col">Project</th><th scope="col">Client</th><th scope="col">Manager</th><th scope="col">Stage</th>{summaryOnly ? null : <><th scope="col">Next milestone</th><th scope="col">Attention needed</th></>}</tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} data-selected={last === p.id} className="cursor-pointer" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) return; remember(p.id); router.push(open(p)); }}>
              <td>
                <Link href={open(p)} onClick={() => remember(p.id)} className={`${nameLink} cx-trunc`} title={p.name}>{p.name}</Link>
                <span className="text-[13px] text-muted-foreground">{p.ref}</span>
              </td>
              <td><ClientCell p={p} /></td>
              <td><span className="cx-trunc" title={pmName(p.pm)}>{pmName(p.pm)}</span></td>
              <td><StageBadge stage={p.stage} /></td>
              {summaryOnly ? null : <><td><NextCell p={p} /></td><td><AttentionCell notes={attentionFor(p)} /></td></>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Phones and narrow windows: one card per project, the whole card is the tap target. */
function ProjectCards({ rows, summaryOnly, open, remember, attentionFor }: ListProps) {
  return (
    <ul className="space-y-2.5 lg:hidden" aria-label="Projects">
      {rows.map((p) => (
        <li key={p.id} className="relative rounded-lg bg-card p-4 transition-colors hover:bg-secondary/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">{p.ref}</p>
              <Link href={open(p)} onClick={() => remember(p.id)} className={`${nameLink} block break-words text-base after:absolute after:inset-0 after:content-['']`}>{p.name}</Link>
            </div>
            <StageBadge stage={p.stage} />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{p.kind === "internal" ? "Internal" : p.client} · {pmName(p.pm)}</p>
          {summaryOnly ? null : (
            <div className="mt-3 grid gap-2 border-t border-border/60 pt-3 text-sm sm:grid-cols-2">
              <div><span className="block text-[13px] text-muted-foreground">Next milestone</span><NextCell p={p} /></div>
              <div><span className="block text-[13px] text-muted-foreground">Attention needed</span><AttentionCell notes={attentionFor(p)} /></div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProjectBoard({ rows, summaryOnly, open, remember, attentionFor, showCompleted }: ListProps & { showCompleted: boolean }) {
  const cols = STAGES.filter((s) => s.id !== "completed" || showCompleted);
  const items: BoardItem[] = rows.map((p) => ({
    id: p.id, columnId: p.stage, title: p.name, moveTo: [],
    card: (
      <div className="min-w-0 text-sm">
        <p className="text-[13px] text-muted-foreground">{p.ref}</p>
        <Link href={open(p)} onClick={() => remember(p.id)} className={`${nameLink} block break-words`}>{p.name}</Link>
        <p className="mt-1 text-muted-foreground">{p.kind === "internal" ? "Internal" : p.client} · {pmName(p.pm)}</p>
        {summaryOnly ? null : (
          <div className="mt-2 space-y-1.5">
            <NextCell p={p} />
            {attentionFor(p).length ? <AttentionCell notes={attentionFor(p)} /> : null}
          </div>
        )}
      </div>
    ),
  }));
  return (
    <div>
      <h2 className="sr-only">Projects by stage</h2>
      <p className="mb-2 text-sm text-muted-foreground">The same projects, grouped by stage. A project’s stage is changed from inside the project.</p>
      <Board columns={cols} items={items} ariaLabel="Projects by stage" emptyColumnText="No projects" onMove={async () => ({ kind: "error", message: "Stage is changed from inside the project." })} />
    </div>
  );
}
