# People & Access: account controls, what was verified and what is left

> **Hosted verification: PARTIALLY DONE (2026-10-27).** The focused account checks were run on **Production (V2)** after #50 was merged, with the existing `hrtest.admin@enginious.ae` (preserved, never changed) and one disposable invitee `e2e-test-employee@enginious.ae`. What was observed is recorded under "Hosted results (Production)" below, as reported by the owner. **Everything not listed there as verified remains unverified**, in particular the direct-data token window, resend invitation, the unauthorised-view check and a password reset ending another session. No hosted SQL has been applied for PR #51.

The account controls (invite, resend, password reset, deactivate, reactivate, delete) moved from *Admin → Users & roles* to **People & Access → Account**. Moving them could break them without a button ever disappearing, so they were exercised for what they **do**, not for whether they are shown.

## How it was verified, and how far that goes

The local stack has no Supabase Auth, and building the real auth server from source was not permitted in the session that did this work, so the local stack gained an **in-repository stand-in** for the auth endpoints these controls call: `packages/e2e-tests/local-stack/local-auth.mjs` (used by `gateway.mjs`). It is written from the documented behaviour of those endpoints and mirrors the parts the design relies on:

* a **banned** user cannot sign in or refresh a token, and `GET /user` answers 403 even with a valid access token; the data API does **not** know about bans;
* a revoked or missing session answers 403 on `GET /user`; `logout?scope=others` revokes every other session;
* `/admin/*` needs the service-role key, anything else is refused; inviting or creating an existing address is refused; `/recover` always answers 200;
* an invitation or reset "e-mail" is not sent: its link is recorded in `local_auth.outbox`, in the shape the set-password page expects, so a test can open it.

It is **not Supabase Auth**. It proves the application: its screens, its server actions, its row-level security, the order of its calls and what it does with each answer. It cannot prove how the hosted service behaves (e-mail delivery, link format and expiry, the real ban, the real session revocation). That is what the hosted plan below is for.

## Results (all run against the app built from this branch and the throwaway database)

| What | How | Result |
|---|---|---|
| Account controls shown only to a System Administrator; an HR Admin or a plain employee gets none; old `/admin/users` leads to People & Access | `e2e-account-security` read-only specs (14) | pass |
| Deactivation needs a reason; a dismissed or blank prompt changes nothing | same | pass |
| Deactivate blocks a **new** sign-in; reactivate restores it; both audited | `e2e-account-security` mutating spec | pass |
| An **already signed-in session** is denied on its next request after deactivation, on two different pages, and works again after reactivation | `existing-session-blocked-on-deactivation` | pass |
| Admin "Send password reset" is audited; change password signs out other sessions; sign out of all devices; forgot-password answers the same for a real and an unknown address | mutating specs (7 in all) | pass |
| **Invitation**: the invitation is sent from the screen and the account is *Invited*; a weak first password is refused and changes nothing; the link sets the password, the account becomes *Active*, and the person signs in | `tests/local-auth/invitation-reset-and-access.spec.ts` (new) | pass |
| Inviting an address that already has an account is refused and points to *Resend invite* | same | pass |
| **Resend invite** for someone who has not accepted (no *Send password reset* is offered yet); its link sets the first password; audited | same | pass |
| **Administrator's reset**: link sent and audited; the old password stops working, the new one works, and the person's *other* session is cut off | same | pass |
| A reset link still unused when the account is **deactivated** no longer works, and reactivating does not revive it | same | pass |
| **Delete**: the login and its profile are removed; an administrator is not offered Delete or Deactivate on their own account | same | pass |
| **Unauthorised**: HR Admin and a plain employee are offered no invitation or account control, cannot list an account they do not manage, and are redirected from the old address; the service-role key appears in no page, script or data response | same | pass |
| **Unauthorised, server side**: with nobody signed in, no role, HR Admin, CEO or Finance, `inviteUser`, `resendInvite`, `deleteUserAccount` and `adminSendPasswordReset` refuse and reach no service; malformed input is refused first; a System Administrator cannot delete themselves; a refusal caused by historical records is explained | `apps/web/src/lib/actions/users.test.ts` (new, 15 tests) plus the existing `account-status.test.ts` (deactivate and reactivate order, compensation, reconciliation) | pass |
| Role grants and revocations stay with the System Administrator, and the last-System-Administrator guard | existing database tests (`account_security_controls`, `people_access_findings`) | pass |

Two things the local stack needed, both about the stack and not the application: the service role had no table privileges (hosted Supabase gives them by default; added to `build-db.sh`), and the gateway did not answer browser calls cross-origin (the set-password page calls the auth server from the browser; CORS added).

**First-password "mark Active" (found, assessed, fixed).** The set-password and reset-password page ignored the result of the write that marks the account *Active*. Reproduced locally by failing that one request: the person landed signed in on the home page with no message while the database still said *Invited*. Nothing in the application or the database gates access on that status, so it was an inconsistency and not a lock-out; its effect was that an administrator saw an accepted invitation as pending (*Resend invite* offered, *Send password reset* hidden). Fixed in `a5a2b30`: the write is read back (it matches nothing for someone already Active, the normal case for a reset), retried twice, and only then reported; the person is told the password is saved and can *Try again* without setting it a second time, or *Continue to the app*. Covered by 8 component tests and a browser spec that fails the write on purpose.

## Hosted results (Production, 2026-10-27)

Run on Production (V2) by the owner after #50 merged (merge commit `217e566`), with the existing administrator `hrtest.admin@enginious.ae` and one disposable invitee `e2e-test-employee@enginious.ae`, following [people-access-hosted-test-runbook.md](./people-access-hosted-test-runbook.md). Recorded exactly as reported; nothing here is inferred.

**Observed and verified on Production**

| Check | Observation |
|---|---|
| Invitation | the invitation e-mail arrived |
| First password / password reset | password setup/reset worked, and the account showed **Active** (the success path of the first-password page; its failure path was not exercised on Production and is covered only by the local tests) |
| Deactivation, an existing session | the already signed-in session was sent to sign-in on its **next navigation** (application level) |
| Deactivation, a fresh sign-in | refused while the account was deactivated |
| Reactivation | worked; a sign-in then succeeded |
| Cleanup | the disposable account was deleted |
| Cleanup SQL (`hosted_account_test_95_after_readonly.sql`) | 0 disposable accounts, 0 role grants held by them; the administrator remains **Active** and a **global System Administrator** |

**Before and after fingerprints (identical, so the administrator and every real account were unchanged)**

| Fingerprint | Value (before = after) |
|---|---|
| Administrator role fingerprint (account and every role row) | `f38365f4d996116b4e805050c6b5694b` |
| Real-account status hash (every non-test account, including the administrator) | `35b49676063a66398eb6256e0cef5e3f` |
| Real accounts | 12, all Active |

**Not verified. Do not read any of these as passed.**

* **Direct-data token access after deactivation (H4 measurement):** not performed. Whether a deactivated account's already-issued token can still read data through the data API, and for how long, is **unknown**. No token or Auth setting was changed on an assumption. The question stays open (see the next section).
* **Resend invitation** (H2, optional): not performed.
* **Unauthorised-view check as a plain account** (H6): not separately verified on Production (proved locally and by unit tests only).
* **A password reset ending another session of the same person** (the other-session part of H3): not separately verified.
* **E-mail and link detail beyond "arrived":** link expiry, link content and where each link landed were not recorded.
* **The administrator-triggered *Send password reset* e-mail as a separate step, the consistency check button, and the automated specs (H8, not run on V2 by design):** not recorded as performed.

## What a ban does and does not do (still to confirm on the hosted project)

Deactivation bans the login at the auth service first and only then marks the profile. The application checks the session with the auth service on **every page and action** (`proxy.ts` and `getCurrentSession` call `getUser()`), so a deactivated person is turned away immediately, as the specs show. A ban does not revoke an **access token already issued**: until it expires, that token is still accepted by the *data API* (row-level security still limits it to what that person could already read and change). So the real exposure window is the project's access-token lifetime (the hosted default is one hour). Step H4 of the runbook measures it; if it is longer than you want, shortening it is a project setting, not a code change.

## Hosted test plan

Now a runbook, **run on Production after #50 is merged**, for **V2, using your existing `hrtest.admin@enginious.ae` as the test administrator (preserved: never changed, and fingerprinted before and after) and only two new disposable `e2e-test-` invitees, with no new project and no setting changed**: [people-access-hosted-test-runbook.md](./people-access-hosted-test-runbook.md). It gives the minimum setup (nothing created by hand), two **read-only** SQL checks (before, with a fingerprint of the administrator's account and every role it holds; after, which must match it, show the invitees gone and a hash over every real account unchanged), H1 to H7 step by step, the token-window measurement, and the result sheet. H8 (the automated specs) is deliberately not run on V2. It was run in part on 2026-10-27: see "Hosted results" above for what was and was not verified.

## Still not verified

* The **access-token window**: whether a deactivated account's already-issued token still reads data through the data API, and until when (the measurement in step H4 of the runbook was not run).
* Resend invitation; the plain-account unauthorised view on Production; a password reset ending another session; link expiry and content; the failure path of the first-password page on Production.
* How the hosted service itself behaves beyond what was observed above: Supabase's own session revocation timing and the e-mail templates (the local stand-in produces the shapes the pages expect; it does not prove the hosted ones).
