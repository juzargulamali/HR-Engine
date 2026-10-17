import { OPPORTUNITIES } from "../../../_lib/data";
import { OpportunityDetail } from "../../../_components/opportunity-detail";

// Only the reference crosses to the client; unknown references 404 instead of rendering.
export const dynamicParams = false;

export function generateStaticParams() {
  return OPPORTUNITIES.map((o) => ({ ref: o.ref }));
}

export default async function OpportunityPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <OpportunityDetail refId={ref} />;
}
