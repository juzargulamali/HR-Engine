"use client";

import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import { ArrowLeft, Calendar, ClipboardList, MessageSquare, Package } from "lucide-react";
import { MoreMenu } from "@/components/workspace/more-menu";
import { withParams } from "@/components/workspace/url-state";
import { fmtDay, pmName, projectById, timelineOf, type Project } from "../_lib/sample";
import { equipmentShort, isMember, nextActions } from "../_lib/logic";
import { useConcept } from "../_lib/store";
import { Badge, EmptyNote, LoadError, Notice, SkeletonRows, StageBadge } from "./bits";
import { Hero, TeamStack } from "./hero";
import { WorkView, AddTask } from "./work-view";
import { TimelineView } from "./timeline-view";
import { DiscussionView } from "./discussion-view";
import { EquipmentView } from "./equipment-view";
import { TaskPanel } from "./task-panel";

const BASE = "/os-preview/concept";
export type TabId = "work" | "timeline" | "discussion" | "equipment";
const TABS: { id: TabId; label: string; Icon: typeof Calendar }[] = [{ id: "work", label: "Work", Icon: ClipboardList }, { id: "timeline", label: "Timeline", Icon: Calendar }, { id: "discussion", label: "Discussion", Icon: MessageSquare }, { id: "equipment", label: "Equipment", Icon: Package }];
const SHELL = "mx-auto w-full max-w-[1400px] px-4 pb-24 pt-3 sm:px-6 sm:pt-2 lg:px-8";

export function ProjectWorkspaceView({ id }: { id: string }) {
  const { persona, listQuery, href } = useConcept();
  const back = `${BASE}${listQuery ? `?${listQuery}` : persona.id !== "pm" ? `?as=${persona.id}` : ""}`;
  const project = projectById(id);
  const visible = project && persona.companies.includes(project.company);
  if (!project || !visible) {
    return (
      <div className={SHELL}>
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
  return <Link href={to} className="inline-flex items-center gap-1.5 rounded-md py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"><ArrowLeft className="h-4 w-4" aria-hidden /> Projects</Link>;
}

/** What a directory-only colleague sees: that the project exists and who runs it. Nothing else. */
function SummaryOnly({ project, back }: { project: Project; back: string }) {
  return (
    <div className={`${SHELL} max-w-3xl`}>
      <BackLink to={back} />
      <div className="cx-card mt-4 p-5">
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
  const actions = nextActions(persona, projectTasks, items, projectLines);
  const here = `${BASE}/${project.id}`;
  const go = (patch: Record<string, string | null>) => href(here, patch);
  const open = projectTasks.find((t) => t.id === taskId) ?? null;
  const [title, sub] = project.name.split(/:\s*/) as [string, string | undefined];
  const subtitle = [sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : null, project.kind === "internal" ? "Internal project" : project.client].filter(Boolean).join(" · ");

  const tabCount: Partial<Record<TabId, string>> = {
    work: projectTasks.length ? String(projectTasks.filter((t) => t.status !== "done").length) : undefined,
    discussion: member ? String(messages.filter((m) => m.projectId === project.id).length) : undefined,
    equipment: equipmentShort(projectLines).length ? "Short" : undefined,
  };
  const boundary = (text: string) => () => notify("info", text);

  return (
    <div className={SHELL}>
      <BackLink to={back} />
      <div className="mt-2 lg:mt-0">
        <Hero
          eyebrow={project.ref}
          title={title}
          sub={<><span className="hidden sm:inline">{project.ref} · </span>{subtitle}</>}
          meta={<>
            <StageBadge stage={project.stage} />
            <span>Manager: <span className="font-medium text-white">{pmName(project.pm)}</span></span>
            {project.install ? <span>Installation: <span className="font-medium text-white">{fmtDay(project.install)}</span></span> : null}
            {project.show ? <span>Show: <span className="font-medium text-white">{fmtDay(project.show)}</span></span> : null}
            {project.kind === "internal" ? <span>No install or show dates</span> : null}
          </>}
        >
          <TeamStack project={project} assignees={projectTasks.map((t) => t.assignee)} />
          <span aria-hidden className="hidden h-9 w-px bg-white/20 sm:block" />
          {tab === "work" && persona.kind !== "directory" ? <AddTask project={project} here={here} /> : null}
          <MoreMenu label="More" items={[
            { key: "settings", label: "Project settings", onSelect: boundary("Project settings are not part of this concept. They stay in the live app.") },
            { key: "people", label: "People and access", onSelect: boundary("People and access are not part of this concept. Access rules are unchanged.") },
            { key: "files", label: "Files", onSelect: boundary("Files are not part of this concept.") },
            { key: "history", label: "History", onSelect: boundary("History is not part of this concept.") },
            { key: "complete", label: "Mark project complete", hint: "Asks for confirmation in the live app", separatorBefore: true, onSelect: boundary("Completing a project is not part of this concept. Nothing was changed.") },
          ]} />
        </Hero>
      </div>

      <nav aria-label="Project sections" className="mt-3 grid grid-cols-4 border-b border-border sm:mt-3 sm:flex sm:gap-1">
        {TABS.map((t) => (
          <Link key={t.id} href={go({ tab: t.id === "work" ? null : t.id, task: null, ms: null, eq: null })} scroll={false} aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-px flex min-h-[3.5rem] flex-col items-center justify-center gap-1 border-b-[3px] px-1 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex sm:min-h-10 sm:flex-row sm:gap-2 sm:border-b-2 sm:px-4 sm:text-[0.9375rem] sm:font-medium ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <span>{t.label}</span>
            {tabCount[t.id] ? <span className="hidden sm:inline-flex"><Badge tone={t.id === "equipment" ? "amber" : t.id === "discussion" ? "blue" : "neutral"}>{tabCount[t.id]}</Badge></span> : null}
            {tabCount[t.id] ? <span className="sr-only sm:hidden">{tabCount[t.id]}</span> : null}
            <span className="relative order-first sm:hidden" aria-hidden>
              <t.Icon className="h-5 w-5" />
              {tabCount[t.id] && t.id !== "equipment" ? <span className="absolute -right-3.5 -top-2 min-w-[1.1rem] rounded-full bg-[hsl(var(--foreground)/0.14)] px-1 text-center text-[11px] font-bold leading-[1.1rem] text-foreground">{tabCount[t.id]}</span> : null}
              {tabCount[t.id] && t.id === "equipment" ? <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-[hsl(var(--cx-amber))]" /> : null}
            </span>
          </Link>
        ))}
      </nav>

      <div className="mt-4 sm:mt-5">
        {forced === "loading" ? <SkeletonRows label={`Loading ${tab}`} /> : forced === "error" ? <LoadError what={TABS.find((t) => t.id === tab)!.label} onRetry={() => setForced("none")} /> : (
          tab === "work" ? <WorkView project={project} tasks={projectTasks} items={items} actions={actions} here={here} /> :
          tab === "timeline" ? <TimelineView project={project} tasks={projectTasks} items={items} here={here} /> :
          tab === "discussion" ? <DiscussionView project={project} tasks={projectTasks} member={member} here={here} /> :
          <EquipmentView project={project} lines={projectLines} here={here} />
        )}
      </div>

      {open ? <TaskPanel key={open.id} task={open} project={project} closeHref={withParams(pathname, sp, {}, ["task"])} here={here} /> : null}
    </div>
  );
}
