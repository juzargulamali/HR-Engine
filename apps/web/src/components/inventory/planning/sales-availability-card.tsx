import { Suspense } from "react";
import { hasInvCapability } from "@enginious-hr/domain";
import { getInventoryContext } from "@/lib/inventory/context";
import { salesCheckView } from "@/lib/inventory/planning";
import { isNotInstalled } from "@/lib/projects/errors";
import { createClient } from "@/lib/supabase/server";
import { AvailabilityCardView } from "./sales-card-view";

/**
 * The "Warehouse stock check" card of the enquiry panel. It can never break the Sales panel: it loads behind a Suspense boundary and
 * every failure (Inventory not installed, the person has no use for it, the data service down) makes it disappear instead of showing an
 * error or a made-up answer.
 */
export function EquipmentAvailabilityCard(props: { opportunityId: string; companyId: string; stage: string; canAsk: boolean }) {
  return (
    <Suspense fallback={null}>
      <EquipmentAvailabilityCardContent {...props} />
    </Suspense>
  );
}

interface CardData { view: NonNullable<ReturnType<typeof salesCheckView>>; locations: { id: string; name: string }[]; canAsk: boolean; canRecord: boolean }

async function loadCard({ opportunityId, companyId, stage, canAsk }: { opportunityId: string; companyId: string; stage: string; canAsk: boolean }): Promise<CardData | null> {
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("inv_opportunity_availability", { p_opportunity_id: opportunityId });
    if (error) {
      // Not installed, or "not found" for someone who has no use for it: quietly nothing. Anything else is logged, still nothing.
      if (!isNotInstalled(error) && (error as { code?: string }).code !== "P0002") console.error("[inventory] opportunity availability failed", error.message);
      return null;
    }
    const view = salesCheckView(data);
    if (!view) return null;
    const ctx = await getInventoryContext().catch(() => null);
    const { data: locs } = await db.from("inv_locations").select("id, name").eq("company_id", companyId).eq("is_active", true).order("name");
    const closed = stage === "won" || stage === "lost";
    const canRecord = !closed && !!ctx && (hasInvCapability(ctx.grants, companyId, "warehouse") || hasInvCapability(ctx.grants, companyId, "manage_catalogue"));
    return { view, locations: locs ?? [], canAsk: canAsk && !closed, canRecord };
  } catch (e) {
    console.error("[inventory] equipment availability card failed", e);
    return null;
  }
}

export async function EquipmentAvailabilityCardContent(props: { opportunityId: string; companyId: string; stage: string; canAsk: boolean }) {
  const card = await loadCard(props);
  if (!card) return null;
  return <AvailabilityCardView view={card.view} opportunityId={props.opportunityId} locations={card.locations} canAsk={card.canAsk} canRecord={card.canRecord} />;
}
