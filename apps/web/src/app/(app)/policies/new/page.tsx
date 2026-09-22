import { canDraftPolicy } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { DraftPolicyForm } from "./draft-policy-form";

export default async function NewPolicyPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: countries } = await supabase.from("countries").select("code, name").order("name");
  const draftableCountries = (countries ?? []).filter((c) => canDraftPolicy(session.grants, c.code));

  if (draftableCountries.length === 0) {
    return (
      <Alert variant="destructive">
        You need an HR Admin grant scoped to a country (not just a single company) to draft policy — see
        docs/02-database-schema.md §2.4.
      </Alert>
    );
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Draft a policy</CardTitle>
      </CardHeader>
      <CardContent>
        <DraftPolicyForm countries={draftableCountries} />
      </CardContent>
    </Card>
  );
}
