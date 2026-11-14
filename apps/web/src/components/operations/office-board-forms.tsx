"use client";

import { useActionState, useState } from "react";
import { createDisplayAccount, revokeDisplayAccount, type CreateDisplayState } from "@/lib/actions/operationsTv";
import type { ActionState } from "@/lib/actions/companies";
import { Modal } from "@/components/sales/modal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { COMMON_TIME_ZONES } from "@/lib/projects/format";
import { DEFAULT_OFFICE_TZ } from "@/lib/operations-tv/accounts";

const labelCls = "block text-sm font-medium";

/**
 * Add a display: one sign-in for one TV, for one company. The password is generated on the server and shown ONCE, here, after it is made. It is not stored anywhere that can show it again; if it is lost, revoke the
 * display and add a new one.
 */
export function AddDisplayDialog({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CreateDisplayState, FormData>(createDisplayAccount, { error: null });
  const [shown, setShown] = useState(false);
  const created = state.created;
  const close = () => { setOpen(false); setShown(false); };
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} data-testid="ops-board-add">Add a display</Button>
      <Modal open={open} onClose={close} title="Add an office board display" description={`A sign-in for one TV showing ${companyName} only. It can open the office board and nothing else.`}>
        {created ? (
          <div className="space-y-3" data-testid="ops-board-created">
            <Alert role="status">Display “{created.label}” is ready. Copy the password now: it is shown only once and cannot be looked up later.</Alert>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-muted-foreground">Sign in at</dt><dd className="break-all font-medium">/login, then the board opens at /tv</dd></div>
              <div><dt className="text-muted-foreground">E-mail</dt><dd className="break-all font-medium" data-testid="ops-board-email">{created.email}</dd></div>
              <div>
                <dt className="text-muted-foreground">Password</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-secondary px-2 py-1 text-xs" data-testid="ops-board-password">{shown ? created.password : "•".repeat(24)}</code>
                  <Button type="button" size="sm" variant="outline" onClick={() => setShown((v) => !v)} aria-pressed={shown}>{shown ? "Hide" : "Show"}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(created.password).catch(() => {}); }}>Copy</Button>
                </dd>
              </div>
            </dl>
            <Button type="button" onClick={close} data-testid="ops-board-created-done">Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="companyId" value={companyId} />
            <div>
              <label className={labelCls} htmlFor="ob-label">Display name</label>
              <Input id="ob-label" name="label" required maxLength={60} placeholder="Office TV" autoComplete="off" />
            </div>
            <div>
              <label className={labelCls} htmlFor="ob-email">Sign-in e-mail</label>
              <Input id="ob-email" name="email" type="email" required placeholder="office-tv@yourcompany.example" autoComplete="off" />
              <p className="mt-1 text-xs text-muted-foreground">Use a shared mailbox or any address that is not a person’s own. No message is sent.</p>
            </div>
            <div>
              <label className={labelCls} htmlFor="ob-tz">Office time zone</label>
              <Select id="ob-tz" name="officeTz" defaultValue={DEFAULT_OFFICE_TZ}>{COMMON_TIME_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}</Select>
            </div>
            {state.error ? <Alert variant="destructive" data-testid="ops-board-error">{state.error}</Alert> : null}
            {state.warning ? <Alert role="status">{state.warning}</Alert> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending} data-testid="ops-board-create">{pending ? "Creating…" : "Create display"}</Button>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

/** Revoke (or, for an already revoked display whose sign-in block failed, retry the block). Asks first; the board of that display clears on its next refresh. */
export function RevokeDisplayButton({ displayId, userId, label, retry = false }: { displayId: string; userId: string; label: string; retry?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(revokeDisplayAccount, INITIAL);
  const done = open && !pending && state.error === null && state !== INITIAL;
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`ops-board-revoke-${displayId}`}>{retry ? "Retry sign-in block" : "Revoke"}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={retry ? `Block the sign-in of “${label}”` : `Revoke “${label}”`}
        description={retry ? "The display is already revoked. This blocks its sign-in at the Auth service again." : "The board on this display clears on its next refresh, and its sign-in is blocked. This cannot be undone: add a new display instead."}>
        {done && !state.warning ? (
          <div className="space-y-3"><Alert role="status" data-testid="ops-board-revoked">Done.</Alert><Button type="button" onClick={() => setOpen(false)}>Close</Button></div>
        ) : (
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="displayId" value={displayId} /><input type="hidden" name="userId" value={userId} />
            {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
            {state.warning ? <Alert role="status" data-testid="ops-board-warning">{state.warning}</Alert> : null}
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={pending} data-testid={`ops-board-revoke-confirm-${displayId}`}>{pending ? "Working…" : retry ? "Block sign-in" : "Revoke display"}</Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
const INITIAL: ActionState = { error: null };
