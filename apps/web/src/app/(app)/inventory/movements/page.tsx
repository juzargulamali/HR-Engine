import { redirect } from "next/navigation";
import { carryParams } from "@/lib/inventory/legacy-redirect";

/** The movement ledger is now History. Old links (including an entry opened with ?open=) keep their parameters. */
export default async function MovementsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(carryParams("/inventory/history", await searchParams));
}
