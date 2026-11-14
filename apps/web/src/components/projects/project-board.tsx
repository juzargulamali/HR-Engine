"use client";

import Link from "next/link";
import { allowedStatusMoves, projectStatusLabel, type ProjectKind } from "@enginious-hr/domain";
import { PanelLink } from "@/components/workspace/panel-link";
import { Board, type BoardItem, type MoveOutcome } from "@/components/workspace/board";
import { KindBadge } from "@/components/projects/badges";
import { StatusDialog } from "@/components/projects/status-dialog";
import { DIRECTORY_LANES, laneMoves, moveForLane } from "@/lib/projects/directory";

export interface BoardProject {
  id: string;
  name: string;
  reference: string;
  kind: ProjectKind;
  isOngoing: boolean;
  status: string;
  pmName: string;
  dates: string;
  /** Where the card leads: the workspace for members, a summary panel for everyone else. */
  href: string;
  panel: boolean;
  /** Only the accountable PM or a founder may request a status change. */
  canMove: boolean;
  unread: number;
  /** The project's next commitment in the shared site wording (null = a summary-only project: not shown). */
  next: { text: string; detail: string | null; href: string | null; needsAction: boolean } | null;
  /** Set when the team has no leads, or no members besides the Project Manager: the words and where to put it right. */
  team: { label: string; manageHref: string } | null;
}

const LANES = DIRECTORY_LANES.map((l) => ({ id: l, label: projectStatusLabel(l) }));

/**
 * The directory as lanes by status. A move is a request: the card opens the status form (reason, review date) and changes lane only
 * after the database has accepted it. Completed and archived projects have no lane (completing has its own flow with evidence).
 */
export function ProjectBoard({ projects }: { projects: BoardProject[] }) {
  const items: BoardItem[] = projects.map((p) => {
    const lanes = p.canMove ? laneMoves({ kind: p.kind, status: p.status }).map((m) => m.lane) : [];
    const Name = p.panel ? PanelLink : Link;
    return {
      id: p.id,
      columnId: p.status,
      title: p.name,
      href: p.href,
      panel: p.panel,
      moveTo: lanes,
      lockedReason: p.canMove ? "This project cannot be moved from here." : "Only the Project Manager or a founder can change the status.",
      card: (
        <div className="space-y-1">
          <Name href={p.href} className="break-words text-sm font-medium leading-snug underline-offset-2 hover:underline">{p.name}</Name>
          {p.unread > 0 ? <span className="ml-2 rounded-full bg-accent px-1.5 text-[13px] font-semibold text-accent-foreground">{p.unread} unread</span> : null}
          <p className="text-sm text-muted-foreground">{p.reference}</p>
          <p className="text-sm">Project Manager {p.pmName}</p>
          <p className="text-sm text-muted-foreground">{p.dates}</p>
          {p.next ? (
            <div className="text-sm" data-testid={`project-next-${p.id}`}>
              {p.next.href ? <Link href={p.next.href} className="break-words font-medium underline-offset-2 hover:underline">{p.next.needsAction ? "⚠ " : ""}{p.next.text}</Link> : <span className="text-muted-foreground">{p.next.text}</span>}
              {p.next.detail ? <span className="block break-words text-[13px] text-muted-foreground">{p.next.detail}</span> : null}
            </div>
          ) : null}
          {p.team ? <p className="text-sm"><span className="text-[hsl(var(--os-amber))]">⚠ {p.team.label}</span> <Link href={p.team.manageHref} className="font-medium underline underline-offset-2">Manage team</Link></p> : null}
          <KindBadge kind={p.kind} ongoing={p.isOngoing} />
        </div>
      ),
    };
  });

  const onMove = async (item: BoardItem, to: string): Promise<MoveOutcome> => {
    const p = projects.find((x) => x.id === item.id);
    const move = p ? moveForLane({ kind: p.kind, status: p.status }, to) : null;
    if (!p || !move) return { kind: "error", message: "That move is not available for this project." };
    const moves = allowedStatusMoves(p.kind, p.status);
    return {
      kind: "dialog",
      render: (close) => <StatusDialog projectId={p.id} projectName={p.name} moves={moves} currentLabel={projectStatusLabel(p.status)} initialTo={move.to} open onClose={close} />,
    };
  };

  return <Board columns={LANES} items={items} onMove={onMove} ariaLabel="Projects by status" emptyColumnText="No projects" />;
}
