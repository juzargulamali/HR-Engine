import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateCompanyForm } from "./create-company-form";
import { DeactivateOrRestoreCompanyButton } from "./deactivate-or-restore-company-button";
import { EmptyState } from "@/components/ui/empty-state";

export default async function CompaniesPage() {
  const supabase = await createClient();
  const [{ data: companies }, { data: countries }] = await Promise.all([
    supabase.from("companies").select("id, legal_name, country_code, default_currency, is_active, deleted_at").order("legal_name"),
    supabase.from("countries").select("code, name").order("name"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Companies</h1>
        <p className="text-muted-foreground">Legal entities employees belong to — one per country branch.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a company</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateCompanyForm countries={countries ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All companies</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Legal name</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(companies ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.legal_name}</TableCell>
                  <TableCell>{c.country_code}</TableCell>
                  <TableCell>{c.default_currency}</TableCell>
                  <TableCell>{c.deleted_at ? "Deactivated" : "Active"}</TableCell>
                  <TableCell>
                    <DeactivateOrRestoreCompanyButton companyId={c.id} deactivated={Boolean(c.deleted_at)} />
                  </TableCell>
                </TableRow>
              ))}
              {(companies ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState dense title="No companies yet." />
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
