"use client";

import { useState } from "react";
import { Check, Copy, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Contact, orgById } from "../_lib/data";
import { Chip } from "./ui";

const ACTION = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); } catch { /* clipboard unavailable: the value stays visible to copy by hand */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" onClick={copy} className={ACTION}>
      {copied ? <Check className="h-3.5 w-3.5 text-[hsl(var(--os-good))]" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      <span>{copied ? "Copied" : label}</span>
      <span className="sr-only" role="status">{copied ? `${label}: copied` : ""}</span>
    </button>
  );
}

const RELATION = { agency: "Agency contact", client: "End-client contact", direct: "Direct client contact" } as const;

/** Everything needed to reach someone, in one place. Links open the user's own phone or mail app on click; nothing is sent from here. */
export function ContactCard({ contact, roleOnOpportunity, className }: { contact: Contact; roleOnOpportunity?: string; className?: string }) {
  const org = orgById(contact.orgId);
  return (
    <div className={cn("min-w-0 rounded-lg border border-border bg-card p-3.5", className)}>
      <p className="break-words text-sm font-semibold">{contact.name}</p>
      <p className="break-words text-sm">{contact.role}</p>
      <p className="break-words text-sm text-muted-foreground">{org.name}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip tone="info">{RELATION[org.type]}</Chip>
        {roleOnOpportunity ? <Chip>{roleOnOpportunity}</Chip> : null}
      </div>
      <dl className="mt-3 space-y-3 border-t border-border/70 pt-3 text-sm">
        <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2">
          <dt className="pt-0.5 text-xs text-muted-foreground">Phone</dt>
          {contact.phone ? (
            <dd><p className="tabular-nums">{contact.phone}</p>
              <p className="mt-1.5 flex flex-wrap gap-2"><CopyButton value={contact.phone} label="Copy number" /><a href={`tel:${contact.phone.replace(/\s+/g, "")}`} className={ACTION}><Phone className="h-3.5 w-3.5" aria-hidden />Call</a></p>
            </dd>
          ) : <dd className="text-muted-foreground">Not recorded</dd>}
        </div>
        <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2">
          <dt className="pt-0.5 text-xs text-muted-foreground">Email</dt>
          {contact.email ? (
            <dd><p className="break-words [overflow-wrap:anywhere]">{contact.email}</p>
              <p className="mt-1.5 flex flex-wrap gap-2"><CopyButton value={contact.email} label="Copy email" /><a href={`mailto:${contact.email}`} className={ACTION}><Mail className="h-3.5 w-3.5" aria-hidden />Email</a></p>
            </dd>
          ) : <dd className="text-muted-foreground">Not recorded</dd>}
        </div>
      </dl>
    </div>
  );
}
