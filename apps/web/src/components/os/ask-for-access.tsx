import { joinNames, loadAccessManagers, type AccessModule } from "@/lib/access/managers";

/**
 * The sentence that tells a denied person WHOM to ask: "Ask Sara Lead or Sam Manager to give you access." The names are those of the people who can manage that module's access
 * in the person's own company (a database function that returns only an identifier and a display name). Nobody listed: the generic wording, unchanged. The read failed: it says it
 * could not load who can grant access, never a blank and never "nobody". Giving a name grants nothing.
 */
export async function AskForAccess({ module, to = "give you access", generic = "a founder" }: { module: AccessModule; to?: string; generic?: string }) {
  const managers = await loadAccessManagers(module);
  if (managers.state === "error") return <span data-testid="ask-access-failed">Could not load who can grant access. Try again in a moment.</span>;
  if (managers.names.length === 0) return <span>Ask {generic} to {to}.</span>;
  return <span data-testid="ask-access-names">Ask {joinNames(managers.names)} to {to}.</span>;
}
