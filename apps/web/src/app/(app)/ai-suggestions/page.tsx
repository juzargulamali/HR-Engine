import { canReviewAiDrafts } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { DraftDecisionButtons } from "./draft-decision-buttons";

export default async function AiSuggestionsPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  if (!canReviewAiDrafts(session.grants)) {
    return <Alert variant="destructive">AI Suggestions is restricted to HR Admin and Sys Admin.</Alert>;
  }

  const supabase = await createClient();
  const { data: drafts } = await supabase
    .from("ai_drafts")
    .select("id, entity_type, proposed_action, proposed_payload, rationale, created_by_agent, status, created_at")
    .eq("status", "draft")
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI Suggestions</h1>
        <p className="text-muted-foreground">
          Every row here is a proposal only — authorizing one runs the exact same Server Action a manual correction
          would, under your own identity. Nothing is ever written automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending review</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Proposal</TableHead>
                <TableHead>Rationale</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(drafts ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.created_by_agent}</TableCell>
                  <TableCell>
                    <span className="font-medium">{d.proposed_action}</span> on {d.entity_type}
                    <pre className="mt-1 max-w-sm overflow-x-auto rounded bg-secondary/50 p-2 text-xs">
                      {JSON.stringify(d.proposed_payload, null, 2)}
                    </pre>
                  </TableCell>
                  <TableCell className="max-w-xs text-muted-foreground">{d.rationale ?? "—"}</TableCell>
                  <TableCell>{new Date(d.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <DraftDecisionButtons draftId={d.id} />
                  </TableCell>
                </TableRow>
              ))}
              {(drafts ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No pending AI suggestions.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
