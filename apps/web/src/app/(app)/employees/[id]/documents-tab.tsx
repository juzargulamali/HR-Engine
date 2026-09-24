import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmployeeDocumentsSection } from "./employee-documents-section";
import { IdentityDocumentsSection } from "./identity-documents-section";

/** Groups the two document sections under one tab — components unchanged. */
export function DocumentsTab({
  employeeId,
  canSeeDocuments,
  canEditDocuments,
  canSeeIdentity,
  canEditIdentity,
}: {
  employeeId: string;
  canSeeDocuments: boolean;
  canEditDocuments: boolean;
  canSeeIdentity: boolean;
  canEditIdentity: boolean;
}) {
  return (
    <div className="space-y-6">
      {canSeeDocuments ? (
        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <EmployeeDocumentsSection employeeId={employeeId} canEdit={canEditDocuments} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeIdentity ? (
        <Card>
          <CardHeader>
            <CardTitle>Identity documents</CardTitle>
          </CardHeader>
          <CardContent>
            <IdentityDocumentsSection employeeId={employeeId} canEdit={canEditIdentity} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
