import { redirect } from "next/navigation";
import { carryParams } from "@/lib/inventory/legacy-redirect";

/** Equipment held by employees moved into Stock (With people). Old links keep their employee, search and filters. */
export default async function EmployeesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(carryParams("/inventory/stock", await searchParams, { view: "people" }));
}
