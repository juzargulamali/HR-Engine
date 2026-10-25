"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { confirmDiscard } from "@/components/workspace/unsaved";
import { withParams } from "@/components/workspace/url-state";
import type { FormContext } from "@/lib/inventory/stock-candidates";
import type { MovementKind } from "@/lib/inventory/stock-movements";
import { MovementForm, type MovementInitial } from "./movement-form";
import { liveServices } from "./movement-services-live";

/** Closing an action panel removes the action (and what prefilled it) from the address; the list behind it is as it was. */
function useClosePanel() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return () => {
    if (!confirmDiscard()) return;
    router.push(withParams(pathname, sp, { action: null, employee: null, project: null, request: null, codes: null, transfer: null, mode: null }), { scroll: false });
  };
}

/** A movement form shown in a side panel (`?action=receive|issue|dispatch|return|transfer`). */
export function MovementPanelBody({ kind, context, initial }: { kind: MovementKind; context: FormContext; initial?: MovementInitial }) {
  const router = useRouter();
  const close = useClosePanel();
  return <MovementForm kind={kind} services={liveServices} context={context} initial={initial} onClose={close} onRecorded={() => router.refresh()} />;
}

/** Send stock to another location, or receive a transfer that has arrived (a separate action on the transfer). */
export function TransferPanelBody({ context, initial, startWith }: { context: FormContext; initial?: MovementInitial; startWith: "send" | "receive" }) {
  const router = useRouter();
  const close = useClosePanel();
  const [mode, setMode] = useState<"send" | "receive">(startWith);
  const open = context.transfers.length;
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Transfer" className="inline-flex rounded-md border border-border p-0.5 text-sm">
        <button type="button" aria-pressed={mode === "send"} onClick={() => setMode("send")} className={`rounded px-3 py-1.5 font-medium ${mode === "send" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Send stock</button>
        <button type="button" aria-pressed={mode === "receive"} onClick={() => setMode("receive")} className={`rounded px-3 py-1.5 font-medium ${mode === "receive" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          Receive a transfer{open > 0 ? ` (${open} on the way)` : ""}
        </button>
      </div>
      {mode === "send"
        ? <MovementForm key="send" kind="transfer" services={liveServices} context={context} initial={initial} onClose={close} onRecorded={() => router.refresh()} />
        : <MovementForm key="receive" kind="receive_transfer" services={liveServices} context={context} initial={initial} onClose={close} onRecorded={() => router.refresh()} />}
    </div>
  );
}

/** A movement form in a dialog (the More menu of an item or unit): opens fresh each time, with a new key. */
export function MovementDialog({ open, onClose, kind, context, initial, title, description }: {
  open: boolean; onClose: () => void; kind: MovementKind; context: FormContext; initial?: MovementInitial; title: string; description?: string;
}) {
  const router = useRouter();
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size="wide">
      <MovementForm kind={kind} services={liveServices} context={context} initial={initial} title={title} onClose={onClose} onRecorded={() => router.refresh()} />
    </Modal>
  );
}
