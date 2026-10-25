"use client";

import { useState } from "react";
import { Lock, Reply, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PanelLink } from "@/components/workspace/panel-link";
import { useUnsavedChanges } from "@/components/workspace/unsaved";
import { PEOPLE, personFirst, personName, type Message, type Project, type Task } from "../_lib/sample";
import { useConcept } from "../_lib/store";
import { Badge, EmptyNote, Notice } from "./bits";

function withMentions(text: string) {
  return text.split(/(@[a-z]+)/gi).map((part, i) => {
    const m = /^@([a-z]+)$/i.exec(part);
    const person = m ? PEOPLE.find((p) => p.id === m[1]!.toLowerCase()) : undefined;
    return person ? <span key={i} className="cx-mention">@{person.name.split(" ")[0]}</span> : <span key={i}>{part}</span>;
  });
}

/** The project's conversation. It stays a conversation: a message never becomes a task unless someone adds one, and it can point to one. */
export function DiscussionView({ project, tasks, member, here }: { project: Project; tasks: Task[]; member: boolean; here: string }) {
  const { messages, addMessage, href } = useConcept();
  const list = messages.filter((m) => m.projectId === project.id);
  const [text, setText] = useState("");
  const [taskId, setTaskId] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges("cx-discussion", text.trim() !== "");

  if (!member) {
    return <Notice title="This discussion is for the people working on the project"><span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" aria-hidden /></span> It is open to the Project Manager, the people with tasks here, the heads of those teams and the founder. You can still see the project’s work and dates.</Notice>;
  }

  const mention = /@([a-z]*)$/i.exec(text)?.[1];
  const people = mention === undefined ? [] : PEOPLE.filter((p) => p.id !== "mina" && (p.id.startsWith(mention.toLowerCase()) || p.name.toLowerCase().startsWith(mention.toLowerCase()))).slice(0, 5);
  const insert = (id: string) => setText((t) => t.replace(/@[a-z]*$/i, `@${id} `));
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    if (await addMessage(project.id, text.trim(), { replyTo: replyTo?.id, taskId: taskId || undefined })) { setText(""); setTaskId(""); setReplyTo(null); }
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-3xl">
      {list.length === 0 ? <EmptyNote title="No messages yet">Start the conversation below. Use @ to mention a colleague.</EmptyNote> : (
        <ol className="space-y-3" aria-label="Messages">
          {list.map((m) => {
            const parent = m.replyTo ? list.find((x) => x.id === m.replyTo) : null;
            const task = m.taskId ? tasks.find((t) => t.id === m.taskId) : null;
            return (
              <li key={m.id} className={`rounded-lg bg-card p-4 ${parent ? "ml-4 sm:ml-8" : ""}`}>
                <p className="text-sm"><span className="font-semibold">{personName(m.who)}</span> <span className="text-muted-foreground">· {m.at}</span></p>
                {parent ? <p className="mt-1 border-l-2 border-border pl-2.5 text-[13px] text-muted-foreground">Replying to {personFirst(parent.who)}: {parent.text.slice(0, 80)}{parent.text.length > 80 ? "…" : ""}</p> : null}
                <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed">{withMentions(m.text)}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                  {task ? <PanelLink href={href(here, { tab: "discussion", task: task.id })} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-secondary/60 px-2 py-1 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Badge tone="quiet">Task</Badge><span className="truncate">{task.title}</span></PanelLink> : null}
                  <button type="button" onClick={() => { setReplyTo(m); document.getElementById("cx-compose")?.focus(); }} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Reply className="h-3.5 w-3.5" aria-hidden /> Reply</button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <form onSubmit={send} className="mt-5 rounded-lg bg-card p-4" aria-label="New message">
        {replyTo ? (
          <p className="mb-2 flex items-center justify-between gap-2 rounded-md bg-secondary/50 px-2.5 py-1.5 text-[13px] text-muted-foreground">
            <span className="min-w-0 truncate">Replying to {personFirst(replyTo.who)}: {replyTo.text}</span>
            <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)} className="rounded p-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-3.5 w-3.5" aria-hidden /></button>
          </p>
        ) : null}
        <label htmlFor="cx-compose" className="sr-only">Message</label>
        <Textarea id="cx-compose" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message. Use @ to mention a colleague." />
        {people.length ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Mention a colleague">
            {people.map((p) => <li key={p.id}><button type="button" onClick={() => insert(p.id)} className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">@{p.name}</button></li>)}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor="cx-link-task" className="sr-only">Link to a task</label>
            <Select id="cx-link-task" value={taskId} onChange={(e) => setTaskId(e.target.value)} className="h-9">
              <option value="">Not linked to a task</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>Link to: {t.title}</option>)}
            </Select>
          </div>
          <Button type="submit" disabled={!text.trim() || busy}>{busy ? "Saving…" : "Send"}</Button>
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">A message is not a task. To give someone work, add a task and link it here. Sample only: messages stay in this tab.</p>
      </form>
    </div>
  );
}
