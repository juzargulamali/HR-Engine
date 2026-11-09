"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionCard, ActionConfirmResult, ConfirmationView, ReplyDraftCard, SendResult, StatusResult } from "@/lib/jarvis/protocol";

/** What the cards of the other actions call. Each is a server action that re-authorises the person on every call; this file decides nothing about access. */
export interface ActionApi {
  act: (a: { companyId: string; actionId: string; input: unknown }) => Promise<SendResult>;
  confirmAction: (a: { companyId: string; actionId: string; token: string; values: unknown; acknowledgements?: Record<string, unknown> }) => Promise<ActionConfirmResult>;
  status: (confirmationId: string) => Promise<StatusResult>;
}

export interface ActionCardState { card: ActionCard; confirmation: ConfirmationView | null }

export interface ActionCardProps {
  actionId: string;
  state: ActionCardState;
  /** The company the person has selected NOW differs from the one this card was made for: it can no longer be used. */
  companyStale: boolean;
  companyId: string;
  api: ActionApi;
  onState: (s: ActionCardState) => void;
}

export function ActionCardView(p: ActionCardProps) {
  switch (p.state.card.kind) {
    case "reply.draft": return <ReplyDraftView card={p.state.card} companyStale={p.companyStale} />;
    default: return null;
  }
}

/** A DRAFT with a copy button. No send button exists, nothing is written, and the "to confirm" list is shown ABOVE the draft. */
function ReplyDraftView({ card, companyStale }: { card: ReplyDraftCard; companyStale: boolean }) {
  const [subject, setSubject] = useState(card.subject);
  const [body, setBody] = useState(card.body);
  const [copied, setCopied] = useState<"idle" | "yes" | "no">("idle");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (copied === "idle") return; const t = setTimeout(() => setCopied("idle"), 2500); return () => clearTimeout(t); }, [copied]);
  async function copy() {
    const text = `Subject: ${subject}\n\n${body}`;
    try { await navigator.clipboard.writeText(text); setCopied("yes"); }
    catch { area.current?.select(); setCopied("no"); }
  }
  return (
    <section aria-label="Draft reply" className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-reply-card">
      <header className="space-y-1">
        <h3 className="font-heading text-sm font-semibold">Draft reply</h3>
        <p className="text-xs text-muted-foreground">For <Link href={`/sales/opportunities/${card.enquiry.id}`} className="font-medium text-foreground underline underline-offset-2">{card.enquiry.reference}</Link> · {card.enquiry.title} · {card.enquiry.stageLabel}. <strong className="text-foreground">This is only a draft: JARVIS has not sent anything and does not send email.</strong></p>
      </header>
      {companyStale ? <Alert variant="warning">The company changed after this draft, so check that it is still the right enquiry before using it.</Alert> : null}
      {card.toConfirm.length > 0 ? (
        <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2" data-testid="reply-to-confirm" role="group" aria-label="To confirm before sending">
          <p className="text-xs font-medium">To confirm before you send it:</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">{card.toConfirm.map((t, i) => <li key={i} data-kind={t.kind}>{t.text}</li>)}</ul>
        </div>
      ) : <p className="rounded-md border border-border bg-secondary/40 p-2 text-xs" data-testid="reply-nothing-to-confirm">No unconfirmed price, date or availability was found in the draft. Read it before you send it: prices and availability are never confirmed by JARVIS.</p>}
      <div className="space-y-1">
        <label htmlFor={`${card.enquiry.id}-subject`} className="text-xs font-medium text-muted-foreground">Subject</label>
        <input id={`${card.enquiry.id}-subject`} value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} className="h-9 w-full rounded-md border border-border bg-field px-3 text-sm" />
        <label htmlFor={`${card.enquiry.id}-body`} className="text-xs font-medium text-muted-foreground">Draft</label>
        <Textarea id={`${card.enquiry.id}-body`} ref={area} rows={10} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} data-testid="reply-body" />
      </div>
      {card.used.length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="reply-used">Used as written: {card.used.map((u) => `${u.value} (from ${u.source === "enquiry" ? "the enquiry" : "your text"})`).join("; ")}.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => void copy()} data-testid="reply-copy">Copy draft</Button>
        <span role="status" className="text-xs text-muted-foreground">{copied === "yes" ? "Copied. Paste it into your email." : copied === "no" ? "Could not copy automatically: the draft is selected, press Ctrl+C." : ""}</span>
      </div>
    </section>
  );
}
