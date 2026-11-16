import { getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadError } from "@/components/workspace/states";
import { InfoHint } from "@/components/ui/info-hint";
import { ruleForKey, typesForCountry, typeKey } from "@/lib/hr/document-types";
import type { ProfileFocus } from "@/lib/hr/focus";
import { AddDocumentForm } from "./add-document-form";
import { loadDocuments } from "./documents-data";
import { DocumentsList } from "./documents-list";

/**
 * The Documents tab: ONE list of every document the viewer may see and ONE Add document form for every kind. The viewer's own gates are unchanged (employee documents: the person
 * and their HR Admin; identity documents: the person and their HR Admin, the tighter tier) and the form only offers a type the viewer may add. Links from setup steps, expiry
 * flags and Renew buttons arrive here with `?add=<type>` (and `&renew=1&docId=`), so the form opens with the employee, company and type already filled in.
 */
export async function DocumentsTab({
  employeeId,
  canSeeDocuments,
  canEditDocuments,
  canSeeIdentity,
  canEditIdentity,
  focus,
  countryCode,
  companyName,
  employeeName,
}: {
  employeeId: string;
  canSeeDocuments: boolean;
  canEditDocuments: boolean;
  canSeeIdentity: boolean;
  canEditIdentity: boolean;
  focus?: ProfileFocus;
  countryCode?: string | null;
  companyName?: string;
  /** Shown at the top of the form; passed by the profile page. */
  employeeName?: string;
  companyId?: string;
}) {
  const today = getBusinessDateString(resolveCountryTimeZone(countryCode ?? ""));
  const data = await loadDocuments({ employeeId, canSeeDocuments, canSeeIdentity, today });
  const here = `/employees/${employeeId}?tab=documents`;
  const anyFailed = data.employeeDocumentsFailed || data.identityDocumentsFailed;

  const allowedStores = [...(canEditIdentity ? (["identity"] as const) : []), ...(canEditDocuments ? (["employee"] as const) : [])];

  // Which type the form opens with: the one a link named, else (coming from the setup step) the first type usual for the country, which is the identity document.
  let initialKey: string | null = null;
  const named = ruleForKey(focus?.add);
  if (named && allowedStores.includes(named.store)) initialKey = typeKey(named.store, named.code);
  else if (focus?.step === "documents") {
    const first = typesForCountry(countryCode).suggested.find((t) => allowedStores.includes(t.store));
    initialKey = first ? typeKey(first.store, first.code) : null;
  }
  const renewed = focus?.renew && initialKey ? data.rows.find((r) => r.id === focus.docId && !r.removed && typeKey(r.store, r.storedType === "other" && r.store === "identity" ? "other_identity" : r.storedType) === initialKey) : undefined;
  const open = initialKey !== null;

  return (
    <div className="space-y-6">
      {canSeeDocuments || canSeeIdentity ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              Documents
              <InfoHint label="About documents" testId="documents-hint">
                <p>Passports, national and residence IDs are kept as identity documents and are readable only by the person and their HR Admin. Visas, labor cards and certificates are kept with their file. Expiry dates are tracked and flagged before they run out. Renewing adds a new document and keeps the earlier one in the history.</p>
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.employeeDocumentsFailed ? <LoadError what="the documents" retryHref={here} /> : null}
            {data.identityDocumentsFailed ? <LoadError what="the identity documents" retryHref={here} /> : null}
            {/* A failed read is not "No documents on file"; adding does not depend on the list, so the form stays. */}
            {anyFailed && data.rows.length === 0 ? null : (
              <DocumentsList employeeId={employeeId} rows={data.rows} canEditEmployeeDocuments={canEditDocuments} canEditIdentity={canEditIdentity} />
            )}
            <AddDocumentForm
              key={`${initialKey ?? "none"}:${renewed?.id ?? ""}`}
              employeeId={employeeId}
              employeeName={employeeName ?? "this employee"}
              companyName={companyName ?? "this company"}
              countryCode={countryCode ?? null}
              allowedStores={allowedStores}
              initialTypeKey={initialKey}
              renew={Boolean(renewed)}
              renewsDocumentId={renewed?.id ?? null}
              previousNumber={renewed?.number ?? null}
              defaultOpen={open}
              closeHref={here}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
