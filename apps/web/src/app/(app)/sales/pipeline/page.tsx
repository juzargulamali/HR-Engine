import { redirect } from "next/navigation";

type Params = Record<string, string | string[] | undefined>;

/** The pipeline is now the Board view of Enquiries. Old bookmarks (with their company filter) land there. */
export default async function PipelineRedirectPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const company = Array.isArray(sp.company) ? sp.company[0] : sp.company;
  redirect(`/sales/opportunities?view=board${company && /^[0-9a-f-]{36}$/i.test(company) ? `&company=${company}` : ""}`);
}
