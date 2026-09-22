import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateCompanyForm } from "./create-company-form";

export default async function CompaniesPage() {
  const supabase = await createClient();
  const [{ data: companies }, { data: countries }] = await Promise.all([
    supabase.from("companies").select("id, legal_name, country_code, default_currency, is_active").order("legal_name"),
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {(companies ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.legal_name}</TableCell>
                  <TableCell>{c.country_code}</TableCell>
                  <TableCell>{c.default_currency}</TableCell>
                  <TableCell>{c.is_active ? "Active" : "Inactive"}</TableCell>
                </TableRow>
              ))}
              {(companies ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No companies yet.
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
