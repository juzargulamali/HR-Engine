import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Panel } from "@/components/projects/parts";
import { isFinishedProject } from "@enginious-hr/domain";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
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

  const supabase = await createClient();
  const { data: rows } = await supabase.from("proj_messages").select("id, seq, parent_id, author_id, body, created_at, edited_at, deleted_at, changed_at").eq("project_id", id).order("seq", { ascending: false }).limit(PAGE + 1);
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
      <Alert role="note">
        This discussion is private to this project&apos;s members and the company&apos;s authorised founders. It is text only, and chat never completes a task, changes the scope, approves anything or moves a date: do those on their own pages.
      </Alert>
      <Panel title="Project discussion" description="New messages appear here by themselves while this page is open.">
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
