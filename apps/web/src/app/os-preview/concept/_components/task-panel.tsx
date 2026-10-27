"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SidePanel } from "@/components/workspace/side-panel";
import { useUnsavedChanges } from "@/components/workspace/unsaved";

import { PEOPLE, TIMELINE, fmtDate, fmtDay, personName, type Project, type Task, type TaskStatus } from "../_lib/sample";
import { canAcceptReview, canAssign, canEditStatus, canManageTask, isOverdue, statusRefusal } from "../_lib/logic";
import { useConcept } from "../_lib/store";
import { AttentionNote, Avatar, Notice, TaskStatusBadge } from "./bits";
import { ChoiceMenu, type Choice } from "./choice-menu";
import { statusChoicesFor } from "./work-view";

const ASSIGNEES: Choice[] = [{ value: "", label: "Unassigned" }, ...PEOPLE.filter((p) => p.id !== "mina").map((p) => ({ value: p.id, label: p.name, avatar: p.name }))];

/** One task beside the list. The list behind it keeps its filters, view and scroll; the address holds the task, so Back closes it. */
export function TaskPanel({ task, project, closeHref, here }: { task: Task; project: Project; closeHref: string; here: string }) {
  const { persona, setStatus, setAssignee, setBlocked, toggleCheck, addComment, href } = useConcept();
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useUnsavedChanges("cx-task-comment", comment.trim() !== "" || reason.trim() !== "");

  const ms = TIMELINE.find((m) => m.id === task.milestoneId) ?? null;
  const done = task.checklist.filter((c) => c.done).length;
  const late = isOverdue(task.due, task.status === "done");
  const mayUnblock = canManageTask(persona, task) || persona.personId === task.blocked?.unblocker;
  const mayAccept = canAcceptReview(persona, task);
  const edit = canEditStatus(persona, task);
  const act = async (key: string, fn: () => Promise<boolean>) => { setBusy(key); await fn(); setBusy(null); };
  const saveStatus = async (next: string) => {
    const refusal = statusRefusal(persona, task, next as TaskStatus);
    if (refusal) return { error: refusal };
    return { error: (await setStatus(task.id, next as TaskStatus)) ? null : "Not saved. Your change was not kept." };
  };

  return (
    <SidePanel title={task.title} subtitle={`${project.ref} · Task`} closeHref={closeHref}>
      <div className="space-y-6 text-sm">
        {task.blocked && task.status !== "done" ? (
          <section aria-label="Blocker" className="rounded-lg border border-[hsl(var(--cx-amber)/0.5)] bg-[hsl(var(--cx-amber)/0.1)] p-4">
            <p className="font-semibold text-[hsl(var(--cx-amber))]">Blocked since {task.blocked.since}</p>
            <p className="mt-1">{task.blocked.reason}</p>
            <p className="mt-1 text-muted-foreground">To unblock: {personName(task.blocked.unblocker)}</p>
            {mayUnblock ? <Button type="button" size="sm" variant="outline" className="mt-3" disabled={busy === "unblock"} onClick={() => act("unblock", () => setBlocked(task.id, null))}>{busy === "unblock" ? "Saving…" : "Mark blocker resolved"}</Button> : <p className="mt-2 text-[13px] text-muted-foreground">Only {personName(task.blocked.unblocker)}, a head or the Project Manager marks it resolved.</p>}
          </section>
        ) : null}

        {task.status === "review" ? (
          <section aria-label="Review" className="rounded-lg border border-[hsl(var(--cx-info)/0.5)] bg-[hsl(var(--cx-info)/0.1)] p-4">
            <p className="font-semibold text-[hsl(var(--cx-info))]">Waiting for review</p>
            <p className="mt-1">Sent for review by {personName(task.submittedBy ?? task.assignee)}. Someone else accepts it.</p>
            {mayAccept ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={busy !== null} onClick={() => act("accept", () => setStatus(task.id, "done", "Accepted"))}>{busy === "accept" ? "Saving…" : "Accept"}</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => act("changes", () => setStatus(task.id, "doing", "Changes requested"))}>{busy === "changes" ? "Saving…" : "Ask for changes"}</Button>
              </div>
            ) : <p className="mt-2 text-[13px] text-muted-foreground">{task.submittedBy === persona.personId ? "You cannot accept your own work." : "Only a department head or the Project Manager accepts a review."}</p>}
          </section>
        ) : null}

        <dl className="cx-card grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
          <div><dt className="mb-1 text-muted-foreground">Assignee</dt><dd>{canAssign(persona, task) ? <ChoiceMenu label="Assignee" value={task.assignee ?? ""} choices={ASSIGNEES} pill={false} onSave={async (n) => ({ error: (await setAssignee(task.id, n || null)) ? null : "Not saved. Your change was not kept." })} /> : <span className="inline-flex items-center gap-2">{task.assignee ? <Avatar name={personName(task.assignee)} size="sm" /> : null}{personName(task.assignee)}</span>}</dd></div>
          <div><dt className="mb-1 text-muted-foreground">Status</dt><dd>{edit ? <ChoiceMenu label="Status" value={task.status} choices={statusChoicesFor(persona, task).map((c) => (task.blocked && task.status !== "done" && c.value === task.status ? { ...c, label: "Blocked", tone: "red" as const } : c))} onSave={saveStatus} /> : <TaskStatusBadge status={task.status} blocked={!!task.blocked} />}</dd></div>
          <div><dt className="mb-1 text-muted-foreground">Due</dt><dd className={late ? "font-semibold text-[hsl(var(--cx-amber))]" : ""}>{fmtDate(task.due)}{late ? " · overdue" : ""}</dd></div>
          <div><dt className="mb-1 text-muted-foreground">Milestone or deliverable</dt><dd>{ms ? <Link href={href(here, { tab: "timeline", ms: ms.id, task: null })} scroll={false} className="rounded-sm underline underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{ms.title} · {fmtDay(ms.date)}</Link> : <span className="text-muted-foreground">None</span>}</dd></div>
        </dl>
        {!canAssign(persona, task) || !edit ? <p className="-mt-3 text-[13px] text-muted-foreground">{edit ? "Only a manager assigns work." : "You can read this task. Its owner or a manager changes it."}</p> : null}

        {task.description ? <section className="cx-card p-4"><h3 className="mb-1 font-heading text-sm font-semibold">Description</h3><p className="whitespace-pre-line text-muted-foreground">{task.description}</p></section> : null}

        <section aria-label="Checklist" className="cx-card p-4">
          <h3 className="mb-2 flex items-baseline justify-between font-heading text-sm font-semibold">Checklist <span className="font-sans text-[13px] font-normal text-muted-foreground">{task.checklist.length ? `${done} of ${task.checklist.length} done` : "None"}</span></h3>
          {task.checklist.length ? (
            <ul className="space-y-1">
              {task.checklist.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-1 hover:bg-secondary/50">
                    <input type="checkbox" checked={c.done} onChange={() => void toggleCheck(task.id, c.id)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                    <span className={c.done ? "text-muted-foreground line-through" : ""}>{c.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted-foreground">No checklist on this task.</p>}
        </section>

        <section aria-label="Comments and activity" className="cx-card p-4">
          <h3 className="mb-2 font-heading text-sm font-semibold">Comments and activity</h3>
          {task.activity.length ? (
            <ol className="space-y-3">
              {task.activity.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <Avatar name={personName(a.who)} />
                  <div className={`min-w-0 flex-1 ${a.kind === "comment" ? "rounded-xl bg-secondary/50 px-3 py-2" : "py-1 text-muted-foreground"}`}>
                    <p className="text-[13px]"><span className="font-semibold text-foreground">{personName(a.who)}</span> · {a.at}</p>
                    <p className={`break-words ${a.kind === "comment" ? "mt-0.5 text-sm text-foreground" : "text-[13px]"}`}>{a.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="text-muted-foreground">Nothing yet.</p>}
          <form className="mt-3" onSubmit={async (e) => { e.preventDefault(); if (!comment.trim()) return; setBusy("comment"); if (await addComment(task.id, comment.trim())) setComment(""); setBusy(null); }}>
            <label htmlFor="cx-comment" className="sr-only">Add a comment</label>
            <Textarea id="cx-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" />
            <div className="mt-2 flex justify-end"><Button type="submit" size="sm" disabled={!comment.trim() || busy === "comment"}>{busy === "comment" ? "Saving…" : "Add comment"}</Button></div>
          </form>
        </section>

        <details className="cx-card group">
          <summary className="cursor-pointer select-none rounded-[14px] px-4 py-3 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">More details</summary>
          <div className="space-y-4 border-t border-border p-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Team</dt><dd>{task.team}</dd></div>
              <div><dt className="text-muted-foreground">Needs a review before it is done</dt><dd>{task.needsReview ? "Yes" : "No"}</dd></div>
            </dl>
            {!task.blocked && edit && task.status !== "done" ? (
              <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (!reason.trim()) return; setBusy("block"); if (await setBlocked(task.id, reason.trim())) setReason(""); setBusy(null); }}>
                <label htmlFor="cx-block" className="block font-medium">Mark as blocked</label>
                <Input id="cx-block" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is in the way?" />
                <Button type="submit" size="sm" variant="outline" disabled={!reason.trim() || busy === "block"}>{busy === "block" ? "Saving…" : "Mark as blocked"}</Button>
              </form>
            ) : null}
          </div>
        </details>

        <Notice>Sample data: changes to this task stay in this browser tab and reset on reload.</Notice>
        {task.createdLocally ? <AttentionNote tone="info">Added in this concept</AttentionNote> : null}
      </div>
    </SidePanel>
  );
}
