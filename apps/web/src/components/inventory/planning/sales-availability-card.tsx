import { Suspense } from "react";
import { hasInvCapability } from "@enginious-hr/domain";
import { getInventoryContext } from "@/lib/inventory/context";
import { salesCheckView } from "@/lib/inventory/planning";
import { isNotInstalled } from "@/lib/projects/errors";
import { createClient } from "@/lib/supabase/server";
import { AvailabilityCardRetry } from "./availability-card-retry";
import { AvailabilityCardView } from "./sales-card-view";

/**
 * The "Warehouse stock check" card of the enquiry panel. It can never break the Sales panel: it loads behind a Suspense boundary. It is
 * absent only when it has nothing to say to this person (Inventory not installed, or the person has no use for it). When the data
 * could not be loaded it says so and offers Retry, because a card that silently disappears reads as "no check exists".
 */
export function EquipmentAvailabilityCard(props: { opportunityId: string; companyId: string; stage: string; canAsk: boolean }) {
  return (
    <Suspense fallback={null}>
      <EquipmentAvailabilityCardContent {...props} />
    </Suspense>
  );
}

interface CardData { view: NonNullable<ReturnType<typeof salesCheckView>>; locations: { id: string; name: string }[]; canAsk: boolean; canRecord: boolean }
type Loaded = CardData | "failed" | null;

/** Codes that mean "nothing for this person": not installed, not found for someone with no use for it, no permission. */
const QUIET = new Set(["P0002", "42501"]);

async function loadCard({ opportunityId, companyId, stage, canAsk }: { opportunityId: string; companyId: string; stage: string; canAsk: boolean }): Promise<Loaded> {
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("inv_opportunity_availability", { p_opportunity_id: opportunityId });
    if (error) {
      // Not installed, or "not found" for someone who has no use for it: nothing to show. Anything else is a failed load: logged, and shown as such.
      if (isNotInstalled(error) || QUIET.has((error as { code?: string }).code ?? "")) return null;
      console.error("[inventory] opportunity availability failed", error.message);
      return "failed";
    }
    const view = salesCheckView(data);
    if (!view) {
      console.error("[inventory] opportunity availability returned an unexpected answer");
      return "failed";
    }
    const ctx = await getInventoryContext().catch(() => null);
    const { data: locs } = await db.from("inv_locations").select("id, name").eq("company_id", companyId).eq("is_active", true).order("name");
    const closed = stage === "won" || stage === "lost";
    const canRecord = !closed && !!ctx && (hasInvCapability(ctx.grants, companyId, "warehouse") || hasInvCapability(ctx.grants, companyId, "manage_catalogue"));
    return { view, locations: locs ?? [], canAsk: canAsk && !closed, canRecord };
  } catch (e) {
    console.error("[inventory] equipment availability card failed", e);
    return "failed";
  }
}

export async function EquipmentAvailabilityCardContent(props: { opportunityId: string; companyId: string; stage: string; canAsk: boolean }) {
  const card = await loadCard(props);
  if (card === null) return null;
  if (card === "failed") return <AvailabilityCardRetry />;
  return <AvailabilityCardView view={card.view} opportunityId={props.opportunityId} locations={card.locations} canAsk={card.canAsk} canRecord={card.canRecord} />;
}
