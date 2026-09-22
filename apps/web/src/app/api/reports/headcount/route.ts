import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * A downloadable CSV report — RLS on `employees` does the actual scoping
 * (an HR Admin sees their own company, a plain employee sees only
 * themselves), the same "RLS enforces access control, not the app layer"
 * rule every other page in this codebase follows. No admin client here.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: employees, error } = await supabase
    .from("employees")
    .select("employee_number, first_name, last_name, country_code, job_title, employment_status, employment_type, hire_date, termination_date")
    .is("deleted_at", null)
    .order("last_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const header = [
    "Employee number",
    "First name",
    "Last name",
    "Country",
    "Job title",
    "Employment status",
    "Employment type",
    "Hire date",
    "Termination date",
  ];
  const rows = (employees ?? []).map((e) =>
    [
      e.employee_number,
      e.first_name,
      e.last_name,
      e.country_code,
      e.job_title ?? "",
      e.employment_status,
      e.employment_type,
      e.hire_date,
      e.termination_date ?? "",
    ]
      .map((v) => csvEscape(String(v)))
      .join(","),
  );
  const csv = [header.join(","), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="headcount-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
