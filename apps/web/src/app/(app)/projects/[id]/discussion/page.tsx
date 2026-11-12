import Link from "next/link";
import { redirect } from "next/navigation";
import { isOpenTask } from "@enginious-hr/domain";
import { buttonVariants } from "@/components/ui/button";
import { JumpToTask } from "@/components/projects/jump-to-task";
import { LoadError } from "@/components/workspace/states";
import { Panel } from "@/components/projects/parts";
import { isFinishedProject } from "@enginious-hr/domain";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { loadProjectChat } from "@/lib/chat/data";
import { CHAT_PARAM, holdsOperationsRight } from "@/lib/chat/model";
import { createClient } from "@/lib/supabase/server";
import type { ProjMessageFeedRow } from "@/types/projects";
import { DiscussionClient } from "./discussion-client";

export const metadata = { title: "Discussion" };
const PAGE = 100;

export default async function DiscussionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) return null;
  if (view.level !== "details") redirect(`/projects/${id}`);

  // The project's conversation is its group in Chat. This address is kept for old links and notices: an enrolled member is sent to the project's Work page with the group open in
  // the Chat panel. Someone who may open the project but is not enrolled in it (a founder, for example) is told where the conversation is; they are not shown it.
  // Only a database that does not have project groups yet still shows the old Discussion below.
  const chat = await loadProjectChat(id, view.standing.isMember || holdsOperationsRight(ctx.grants, view.project.company_id));
  if (chat.state === "ready") redirect(`/projects/${id}/work?${CHAT_PARAM}=${chat.groupId}`);
  if (chat.state === "not_member") {
    return (
      <Panel title="Project chat" description="This project's conversation is in Chat.">
        <p className="text-sm text-muted-foreground" data-testid="project-chat-not-member">
          The conversation is open to the people on this project. You can open the project, but you are not on its team, so its chat is not shown to you. The Project Manager can add you under Manage project, People &amp; access.
        </p>
        <Link href={`/projects/${id}/work`} className={buttonVariants({ variant: "outline", size: "sm" })}>Back to Work</Link>
      </Panel>
    );
  }
  if (chat.state === "error") return <LoadError what="the project chat" retryHref={`/projects/${id}/discussion`} />;

  const supabase = await createClient();
  const [{ data: rows, error }, { data: taskRows }] = await Promise.all([
    supabase.from("proj_messages").select("id, seq, parent_id, author_id, body, created_at, edited_at, deleted_at, changed_at").eq("project_id", id).order("seq", { ascending: false }).limit(PAGE + 1),
    supabase.from("proj_tasks").select("id, title, status").eq("project_id", id).order("created_at", { ascending: false }).limit(300),
  ]);
  // A failed read must not look like a silent, empty discussion.
  if (error) return <LoadError what="the discussion" retryHref={`/projects/${id}/discussion`} />;
  const jumpTasks = (taskRows ?? []).map((t) => ({ id: t.id, title: t.title, open: isOpenTask(t.status) }));
  const latest = (rows ?? []).slice(0, PAGE).reverse();
  const ids = latest.map((m) => m.id);
  const { data: mentionRows } = ids.length > 0 ? await supabase.from("proj_message_mentions").select("message_id, user_id").in("message_id", ids) : { data: [] };
  const mentionsBy = new Map<string, string[]>();
  for (const r of mentionRows ?? []) mentionsBy.set(r.message_id, [...(mentionsBy.get(r.message_id) ?? []), r.user_id]);
  const initial: ProjMessageFeedRow[] = latest.map((m) => ({
    id: m.id, seq: m.seq, parent_id: m.parent_id, author_id: m.author_id, author_name: view.nameOf(m.author_id), body: m.body, created_at: m.created_at,
    edited_at: m.edited_at, deleted_at: m.deleted_at, changed_at: m.changed_at, mention_ids: mentionsBy.get(m.id) ?? [],
  }));
  const people = view.people.map((p) => ({ id: p.user_id, name: p.full_name ?? "Unnamed" }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <JumpToTask projectId={id} tasks={jumpTasks} />
        <Link href={`/projects/${id}/documents`} className={buttonVariants({ variant: "outline", size: "sm" })}>Files</Link>
      </div>
      <Panel title="Project discussion" description="Private to the project's members and authorised founders. Text only: a message never creates or completes work, changes scope or moves a date.">
        <DiscussionClient
          projectId={id}
          me={ctx.userId}
          canModerate={view.canManage}
          readOnly={isFinishedProject(view.project.status)}
          initial={initial}
          hasEarlier={(rows ?? []).length > PAGE}
          people={people}
        />
      </Panel>
    </div>
  );
}
