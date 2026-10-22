"use client";

import { useRouter } from "next/navigation";
import { KitPackForm } from "./kit-forms";
import { liveServices } from "./movement-services-live";

/** The kit packing form wired to the real server actions (a server page cannot hand functions to a client component). */
export function LiveKitPackForm(props: Omit<React.ComponentProps<typeof KitPackForm>, "services">) {
  const router = useRouter();
  return <KitPackForm {...props} services={liveServices} onClose={() => { props.onClose?.(); router.refresh(); }} />;
}
