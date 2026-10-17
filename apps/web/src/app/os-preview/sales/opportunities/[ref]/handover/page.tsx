import { OPPORTUNITIES } from "../../../../_lib/data";
import { HandoverView } from "../../../../_components/handover-view";

// Only the reference crosses to the client; unknown references 404 instead of rendering.
export const dynamicParams = false;

export function generateStaticParams() {
  return OPPORTUNITIES.map((o) => ({ ref: o.ref }));
}

export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <HandoverView refId={ref} />;
}
