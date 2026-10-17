"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { CRM_CAPABILITIES, CRM_CAPABILITY_LABELS, type CrmCapability } from "@enginious-hr/domain";
import { grantCrmAccess, revokeCrmAccess } from "@/lib/actions/crm";
import type { ActionState } from "@/lib/actions/companies";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/sales/action-form";
import { formatDate } from "@/components/sales/format";
import { Modal } from "@/components/sales/modal";

export interface AccessCompany {
  id: string;
  name: string;
  /** The viewer holds an explicit founder grant for this company (only a founder may hand out founder or access rights). */
  isFounder: boolean;
}

export interface AccessPerson {
  id: string;
  name: string;
  /** Present only for founders. */
  email: string | null;
}

export interface AccessGrant {
  userId: string;
  companyId: string;
  name: string;
  email: string | null;
  capabilities: CrmCapability[];
  grantedAt: string;
  grantedByName: string | null;
  note: string | null;
}

const initialState: ActionState = { error: null };
const FOUNDER_ONLY: readonly CrmCapability[] = ["founder", "manage_access"];

/** Capabilities the viewer may tick for this company. Founder and access management are founder-only (the database refuses otherwise). */
const allowedCapabilities = (isFounder: boolean) => CRM_CAPABILITIES.filter((c) => isFounder || !FOUNDER_ONLY.includes(c));
const holdsFounderOnly = (g: AccessGrant) => g.capabilities.some((c) => FOUNDER_ONLY.includes(c));

function CapabilityChecklist({
  idPrefix, selected, onToggle, isFounder, lockFounder,
}: {
  idPrefix: string;
  selected: ReadonlySet<CrmCapability>;
  onToggle: (cap: CrmCapability, on: boolean) => void;
  isFounder: boolean;
  /** This person is the company's only founder: they cannot be demoted. */
  lockFounder?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Extra capabilities</legend>
      <p className="text-xs text-muted-foreground">Without any of these, a person can still see Sales for this company and work on their own opportunities and follow-ups.</p>
      <ul className="space-y-2">
        {allowedCapabilities(isFounder).map((cap) => {
          const locked = lockFounder && cap === "founder";
          return (
            <li key={cap}>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={selected.has(cap)} disabled={locked} onChange={(e) => onToggle(cap, e.target.checked)} id={`${idPrefix}-${cap}`} />
                <span className="min-w-0">
                  <span className="font-medium">{CRM_CAPABILITY_LABELS[cap].label}</span>
                  <span className="block text-xs text-muted-foreground">{CRM_CAPABILITY_LABELS[cap].description}{locked ? " This is the company's only founder, so founder rights cannot be removed." : ""}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {!isFounder ? <p className="text-xs text-muted-foreground">Founder and access-management rights can only be given by a founder.</p> : null}
    </fieldset>
  );
}

function CapabilityBadges({ capabilities }: { capabilities: CrmCapability[] }) {
  if (capabilities.length === 0) return <Badge variant="outline">Basic Sales access</Badge>;
  return (
    <>
      {capabilities.map((c) => <Badge key={c} variant={c === "founder" ? "default" : "outline"} className="whitespace-nowrap">{CRM_CAPABILITY_LABELS[c]?.label ?? c}</Badge>)}
    </>
  );
}

function toggled(prev: ReadonlySet<CrmCapability>, cap: CrmCapability, on: boolean): Set<CrmCapability> {
  const next = new Set(prev);
  if (on) next.add(cap); else next.delete(cap);
  return next;
}

// ---------------------------------------------------------------------------------------------------------------

function GrantForm({ companies, staff, grants }: { companies: AccessCompany[]; staff: AccessPerson[]; grants: AccessGrant[] }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [userId, setUserId] = useState("");
  const [caps, setCaps] = useState<ReadonlySet<CrmCapability>>(new Set());
  const [note, setNote] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const company = companies.find((c) => c.id === companyId) ?? null;
  const existing = grants.find((g) => g.userId === userId && g.companyId === companyId) ?? null;
  const blockedByFounder = !!existing && !company?.isFounder && holdsFounderOnly(existing);
  const founderCount = grants.filter((g) => g.companyId === companyId && g.capabilities.includes("founder")).length;
  const lockFounder = !!existing && existing.capabilities.includes("founder") && founderCount <= 1;

  const [state, formAction, pending] = useActionState(async (prev: ActionState, fd: FormData): Promise<ActionState> => {
    const result = await grantCrmAccess(prev, fd);
    if (!result.error) {
      setUserId("");
      setCaps(new Set());
      setNote("");
    }
    return result;
  }, initialState);
  const saved = state !== initialState && state.error === null && clientError === null;
  const error = clientError ?? state.error;

  function pick(nextCompany: string, nextUser: string) {
    const target = companies.find((c) => c.id === nextCompany);
    const had = grants.find((g) => g.userId === nextUser && g.companyId === nextCompany);
    setCompanyId(nextCompany);
    setUserId(nextUser);
    // Choosing someone who already has access starts from what they have now.
    setCaps(new Set((had?.capabilities ?? []).filter((c) => target?.isFounder || !FOUNDER_ONLY.includes(c))));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);
    if (!userId) return setClientError("Choose the person to give access to.");
    if (!company) return setClientError("Choose the company.");
    if (blockedByFounder) return setClientError("Only a founder can change the access of a founder or an access manager.");
    const data = new FormData();
    data.set("userId", userId);
    data.set("companyId", companyId);
    if (note.trim()) data.set("note", note.trim());
    for (const c of allowedCapabilities(company.isFounder)) if (caps.has(c)) data.append("capabilities", c);
    startTransition(() => formAction(data));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Give someone Sales access</CardTitle>
        <CardDescription>Choose a colleague and a company. Choosing someone who already has access lets you change what they can do.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4 max-w-2xl">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Person" htmlFor="grant-user">
              <Select id="grant-user" value={userId} onChange={(e) => pick(companyId, e.target.value)}>
                <option value="">Choose a colleague…</option>
                {staff.map((p) => <option key={p.id} value={p.id}>{p.name}{p.email ? ` (${p.email})` : ""}</option>)}
              </Select>
            </Field>
            <Field label="Company" htmlFor="grant-company">
              <Select id="grant-company" value={companyId} onChange={(e) => pick(e.target.value, userId)}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          {existing ? (
            <Alert role="status">{existing.name} already has Sales access to {company?.name}. Saving replaces their capabilities with the ones ticked below.</Alert>
          ) : null}
          {blockedByFounder ? <Alert variant="warning" role="status">{existing?.name} is a founder or access manager here. Only a founder can change their access.</Alert> : null}
          {company ? (
            <CapabilityChecklist
              idPrefix="grant-cap" selected={caps} isFounder={company.isFounder} lockFounder={lockFounder}
              onToggle={(cap, on) => setCaps((prev) => toggled(prev, cap, on))}
            />
          ) : null}
          <Field label="Note (optional)" htmlFor="grant-note" hint="Why they need access. Kept in the history.">
            <Input id="grant-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          {saved ? <Alert variant="success" role="status">Sales access saved.</Alert> : null}
          <Button type="submit" disabled={pending || blockedByFounder}>{pending ? "Saving…" : existing ? "Save changes" : "Give access"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function ChangeAccessButton({ grant, company, founderCount }: { grant: AccessGrant; company: AccessCompany; founderCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Change<span className="sr-only"> access for {grant.name}</span></Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Change access" description={`${grant.name} · ${company.name}`}>
        <ChangeAccessForm grant={grant} company={company} lockFounder={grant.capabilities.includes("founder") && founderCount <= 1} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function ChangeAccessForm({ grant, company, lockFounder, onClose }: { grant: AccessGrant; company: AccessCompany; lockFounder: boolean; onClose: () => void }) {
  const [caps, setCaps] = useState<ReadonlySet<CrmCapability>>(new Set(grant.capabilities));
  const [state, formAction, pending] = useActionState(async (prev: ActionState, fd: FormData): Promise<ActionState> => {
    const result = await grantCrmAccess(prev, fd);
    if (!result.error) onClose();
    return result;
  }, initialState);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData();
    data.set("userId", grant.userId);
    data.set("companyId", grant.companyId);
    for (const c of allowedCapabilities(company.isFounder)) if (caps.has(c)) data.append("capabilities", c);
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <CapabilityChecklist idPrefix={`edit-${grant.userId}`} selected={caps} isFounder={company.isFounder} lockFounder={lockFounder} onToggle={(cap, on) => setCaps((prev) => toggled(prev, cap, on))} />
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
      </div>
    </form>
  );
}

function RevokeButton({ grant, company, isSelf }: { grant: AccessGrant; company: AccessCompany; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startRevoke] = useTransition();

  function revoke() {
    setError(null);
    startRevoke(async () => {
      const result = await revokeCrmAccess(grant.userId, grant.companyId);
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => { setError(null); setOpen(true); }}>Revoke<span className="sr-only"> access for {grant.name}</span></Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Revoke Sales access" description={`${grant.name} · ${company.name}`}>
        <div className="space-y-4 text-sm">
          <p>{isSelf ? "You are about to remove your own Sales access to this company. " : ""}{grant.name} will lose access to every Sales record of {company.name} straight away. Their HR access, if any, is not affected. The records they created stay.</p>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={revoke}>{pending ? "Revoking…" : "Revoke access"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function CompanyAccess({ company, grants, currentUserId, showEmails }: { company: AccessCompany; grants: AccessGrant[]; currentUserId: string; showEmails: boolean }) {
  const founderCount = grants.filter((g) => g.capabilities.includes("founder")).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="break-words">{company.name}</CardTitle>
        <CardDescription>
          {company.isFounder
            ? "You are a founder here: you can give and remove any Sales access, including founder and access-management rights."
            : "You can manage Sales access here, but only a founder can give, change or remove founder and access-management rights."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {grants.length === 0 ? (
          <EmptyState dense title="Nobody has Sales access to this company yet." description="Use the form above to give someone access." />
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {grants.map((g) => {
              const locked = !company.isFounder && holdsFounderOnly(g);
              const self = g.userId === currentUserId;
              return (
                <li key={g.userId} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{g.name}{self ? <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span> : null}</p>
                      {showEmails && g.email ? <p className="break-all text-xs text-muted-foreground">{g.email}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {locked ? (
                        <span className="text-xs text-muted-foreground">Only a founder can change this</span>
                      ) : (
                        <>
                          <ChangeAccessButton grant={g} company={company} founderCount={founderCount} />
                          <RevokeButton grant={g} company={company} isSelf={self} />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5"><CapabilityBadges capabilities={g.capabilities} /></div>
                  <p className="text-xs text-muted-foreground">
                    Access given {formatDate(g.grantedAt)}{g.grantedByName ? ` by ${g.grantedByName}` : ""}{g.note ? ` · ${g.note}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AccessManager({
  companies, staff, grants, currentUserId, showEmails,
}: {
  companies: AccessCompany[];
  staff: AccessPerson[];
  grants: AccessGrant[];
  currentUserId: string;
  showEmails: boolean;
}) {
  return (
    <div className="space-y-6">
      <GrantForm companies={companies} staff={staff} grants={grants} />
      {companies.map((c) => (
        <CompanyAccess key={c.id} company={c} grants={grants.filter((g) => g.companyId === c.id)} currentUserId={currentUserId} showEmails={showEmails} />
      ))}
    </div>
  );
}
