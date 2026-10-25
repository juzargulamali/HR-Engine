"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { MoreMenu } from "@/components/workspace/more-menu";
import { withParams } from "@/components/workspace/url-state";
import { fmtDay, pmName, projectById, timelineOf, type Project } from "../_lib/sample";
import { attentionOf, equipmentShort, isMember, nextActions } from "../_lib/logic";
import { useConcept } from "../_lib/store";
import { Badge, EmptyNote, LoadError, Notice, SkeletonRows, StageBadge } from "./bits";
import { WorkView } from "./work-view";
import { TimelineView } from "./timeline-view";
import { DiscussionView } from "./discussion-view";
import { EquipmentView } from "./equipment-view";
import { TaskPanel } from "./task-panel";

const BASE = "/os-preview/concept";
export type TabId = "work" | "timeline" | "discussion" | "equipment";
const TABS: { id: TabId; label: string }[] = [{ id: "work", label: "Work" }, { id: "timeline", label: "Timeline" }, { id: "discussion", label: "Discussion" }, { id: "equipment", label: "Equipment" }];

export function ProjectWorkspaceView({ id }: { id: string }) {
  const { persona, listQuery, href } = useConcept();
  const back = `${BASE}${listQuery ? `?${listQuery}` : persona.id !== "pm" ? `?as=${persona.id}` : ""}`;
  const project = projectById(id);
  const visible = project && persona.companies.includes(project.company);
  if (!project || !visible) {
    return (
      <div className="mx-auto w-full max-w-[1320px] px-4 pb-24 pt-6 sm:px-6">
        <h1 className="sr-only">Project not available</h1>
        <BackLink to={back} />
        <div className="mt-6"><EmptyNote title="This project is not available" action={<Link href={back} className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Back to Projects</Link>}>It does not exist, or it belongs to a company this person cannot see.</EmptyNote></div>
      </div>
    );
  }
  if (persona.kind === "directory") return <SummaryOnly project={project} back={back} />;
  return <Workspace project={project} back={back} href={href} />;
}

function BackLink({ to }: { to: string }) {
  return <Link href={to} className="inline-flex items-center gap-1.5 rounded-md py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-4 w-4" aria-hidden /> Projects</Link>;
}

/** What a directory-only colleague sees: that the project exists and who runs it. Nothing else. */
function SummaryOnly({ project, back }: { project: Project; back: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      <BackLink to={back} />
      <div className="mt-4 rounded-lg bg-card p-5">
        <p className="text-sm text-muted-foreground">{project.ref}</p>
        <h1 className="mt-0.5 font-heading text-xl font-semibold">{project.name}</h1>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Client</dt><dd>{project.kind === "internal" ? "Internal project" : project.client}</dd></div>
          <div><dt className="text-muted-foreground">Project Manager</dt><dd>{pmName(project.pm)}</dd></div>
          <div><dt className="text-muted-foreground">Stage</dt><dd className="mt-0.5"><StageBadge stage={project.stage} /></dd></div>
        </dl>
      </div>
      <div className="mt-4"><Notice title="Summary only">Tasks, the timeline, the discussion and equipment are for the people working on this project. If you should be on it, ask {pmName(project.pm)}.</Notice></div>
    </div>
  );
}

function Workspace({ project, back, href }: { project: Project; back: string; href: ReturnType<typeof useConcept>["href"] }) {
  const { persona, tasks, messages, lines, forced, setForced, notify } = useConcept();
  const sp = useSearchParams();
  const pathname = usePathname();
  const tab = (TABS.find((t) => t.id === sp.get("tab"))?.id ?? "work") as TabId;
  const taskId = sp.get("task");
  const projectTasks = tasks.filter((t) => t.projectId === project.id);
  const items = timelineOf(project.id);
  const projectLines = lines.filter((l) => l.projectId === project.id);
  const member = isMember(persona, project, projectTasks);
  const attention = attentionOf(project, projectTasks, items, projectLines);
  const actions = nextActions(persona, projectTasks, items, projectLines);
  const [allActions, setAllActions] = useState(false);
  const here = `${BASE}/${project.id}`;
  const go = (patch: Record<string, string | null>) => href(here, patch);
  const open = projectTasks.find((t) => t.id === taskId) ?? null;

  const actionHref = (a: (typeof actions)[number]) => go({ tab: a.tab, task: a.taskId ?? null, ms: a.milestoneId ?? null, eq: null });
  const tabCount: Partial<Record<TabId, string>> = {
    work: projectTasks.length ? String(projectTasks.filter((t) => t.status !== "done").length) : undefined,
    discussion: member ? String(messages.filter((m) => m.projectId === project.id).length) : undefined,
    equipment: equipmentShort(projectLines).length ? "Short" : undefined,
  };
  const boundary = (text: string) => () => notify("info", text);

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 pb-24 pt-5 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <BackLink to={back} />
        <MoreMenu label="More" items={[
          { key: "settings", label: "Project settings", onSelect: boundary("Project settings are not part of this concept. They stay in the live app.") },
          { key: "people", label: "People and access", onSelect: boundary("People and access are not part of this concept. Access rules are unchanged.") },
          { key: "files", label: "Files", onSelect: boundary("Files are not part of this concept.") },
          { key: "history", label: "History", onSelect: boundary("History is not part of this concept.") },
          { key: "complete", label: "Mark project complete", hint: "Asks for confirmation in the live app", separatorBefore: true, onSelect: boundary("Completing a project is not part of this concept. Nothing was changed.") },
        ]} />
      </div>
      <header className="mt-2">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{project.ref} · {project.kind === "internal" ? "Internal project" : project.client}</p>
            <h1 className="mt-0.5 break-words font-heading text-2xl font-semibold tracking-tight">{project.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              <StageBadge stage={project.stage} />
              <span>Manager: <span className="text-foreground">{pmName(project.pm)}</span></span>
              {project.install ? <span>Installation: <span className="text-foreground">{fmtDay(project.install)}</span></span> : null}
              {project.show ? <span>Show: <span className="text-foreground">{fmtDay(project.show)}</span></span> : null}
              {project.kind === "internal" ? <span>No install or show dates</span> : null}
            </div>
          </div>
        </div>

        {actions.length > 0 && forced === "none" ? (
          <section aria-label="Next action" className="mt-4 rounded-lg border border-primary/35 bg-primary/[0.07] px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1 basis-64">
                <p className="font-medium"><span className="mr-2 text-[13px] font-semibold uppercase tracking-wide text-accent">Next</span>{actions[0]!.label}</p>
                <p className="break-words text-sm text-muted-foreground">{actions[0]!.detail}</p>
              </div>
              <Link href={actionHref(actions[0]!)} scroll={false} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {actions[0]!.tab === "work" ? "Open task" : actions[0]!.tab === "equipment" ? "Open equipment" : "Open timeline"} <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
            {actions.length > 1 ? (
              <div className="mt-1.5">
                <button type="button" aria-expanded={allActions} onClick={() => setAllActions((v) => !v)} className="inline-flex items-center gap-1 rounded-md py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {allActions ? "Hide" : `${actions.length - 1} more to do`} <ChevronDown className={`h-4 w-4 transition-transform ${allActions ? "rotate-180" : ""}`} aria-hidden />
                </button>
                {allActions ? (
                  <ul className="mt-1.5 space-y-1 border-t border-border/60 pt-2">
                    {actions.slice(1).map((a) => (
                      <li key={a.id}><Link href={actionHref(a)} scroll={false} className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0"><span className="font-medium">{a.label}</span><span className="text-muted-foreground"> · {a.detail}</span></span><ArrowRight className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden /></Link></li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : attention.length === 0 && forced === "none" && projectTasks.length > 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nothing needs your attention here right now.</p>
        ) : null}
      </header>

      <nav aria-label="Project sections" className="mt-6 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link key={t.id} href={go({ tab: t.id === "work" ? null : t.id, task: null, ms: null, eq: null })} scroll={false} aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-px inline-flex min-h-10 flex-none items-center gap-2 border-b-2 px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
            {tabCount[t.id] ? <Badge tone={t.id === "equipment" ? "amber" : "neutral"}>{tabCount[t.id]}</Badge> : null}
          </Link>
        ))}
      </nav>

      <div className="mt-5">
        {forced === "loading" ? <SkeletonRows label={`Loading ${tab}`} /> : forced === "error" ? <LoadError what={TABS.find((t) => t.id === tab)!.label} onRetry={() => setForced("none")} /> : (
          tab === "work" ? <WorkView project={project} tasks={projectTasks} here={here} /> :
          tab === "timeline" ? <TimelineView project={project} tasks={projectTasks} items={items} here={here} /> :
          tab === "discussion" ? <DiscussionView project={project} tasks={projectTasks} member={member} here={here} /> :
          <EquipmentView project={project} lines={projectLines} here={here} />
        )}
      </div>

      {open ? <TaskPanel key={open.id} task={open} project={project} closeHref={withParams(pathname, sp, {}, ["task"])} here={here} /> : null}
    </div>
  );
}
