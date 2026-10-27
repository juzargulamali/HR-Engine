# People & Access: account controls, what was verified and what is left

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

**Observation, not changed.** The set-password page goes on to the home page even if its write that marks the account *Active* fails (it ignores that result). On the hosted service that write has no reason to fail, but a failure would leave a person who can sign in shown as *Invited*. Worth a small follow-up; it is not part of this change.

## What a ban does and does not do (to confirm on the hosted project)

Deactivation bans the login at the auth service first and only then marks the profile. The application checks the session with the auth service on **every page and action** (`proxy.ts` and `getCurrentSession` call `getUser()`), so a deactivated person is turned away immediately, as the specs show. A ban does not revoke an **access token already issued**: until it expires, that token is still accepted by the *data API* (row-level security still limits it to what that person could already read and change). So the real exposure window is the project's access-token lifetime (the hosted default is one hour). Step H4 below measures it; if it is longer than you want, shortening it is a project setting, not a code change.

## Hosted test plan (for your approval; nothing has been run)

**Where.** Preferably a disposable Supabase project built from the migrations (not V2), because the specs create and delete accounts with the service-role key and the repository's own README forbids running them against Production. If you prefer V2, only accounts created for this test (below) are ever touched. **No real staff account is deactivated, deleted, reset or invited.**

**You provide:** (1) the project; (2) a mailbox you control that can receive plus-addressed mail (for example `qa+invitee1@…`), because the specs' `…@example.invalid` addresses are deliberately undeliverable; (3) three accounts named `e2e-test-…`: a System Administrator **S**, an HR Admin **H** and a plain employee **P**, created by you in the dashboard. I need nothing else from you, and the service-role key is entered by you into a local environment variable, never into chat or a file.

| Step | Do | Expected |
|---|---|---|
| H1 | As **S**: invite `qa+invitee1@…` from People & Access. Open the e-mail. | A real e-mail arrives; its link opens *Set password*; a weak password is refused; a good one signs them in; the person shows *Active*. |
| H2 | As **S**: invite `qa+invitee2@…`, do not accept; press *Resend invite*. | A second e-mail arrives; its link works exactly as H1; the first link, if still unused, is noted (works or not) in the result. |
| H3 | As **S**: *Send password reset* for **P** while **P** is signed in on a second browser. | E-mail arrives; link sets a new password; the old one is refused; **P**'s other browser is signed out on its next click. |
| H4 | As **S**: *Deactivate* **P** (reason typed). With **P**'s session already open, click any page and perform one action; then try a new sign-in. Then note the time and, with **P**'s old access token from the browser, call the data API once and again after the token lifetime. | **P**'s open session is sent to the sign-in page on its next click; a new sign-in is refused; whether the old token still reads data, and until when, is **written down** (this is the window described above). |
| H5 | As **S**: *Reactivate* **P**; use *Check consistency* on **P** before and after. | **P** signs in again; the check says consistent in both states. |
| H6 | As **H** and as a plain employee: open People & Access and `/admin/users`. | No invitation panel, no Account tab, no Deactivate, Delete or Reset; the old address redirects. |
| H7 | As **S**: delete `qa+invitee1@…` and `qa+invitee2@…`. | Their sign-in stops working; they leave the list. |
| H8 | Automated: `npm run test:e2e:read-only` then `test:e2e:mutating` in `packages/e2e-account-security`, pointed at the disposable project (`E2E_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, anon and service-role keys in your environment). | The same 21 specs as above pass against the real service. The `tests/local-auth` spec skips itself there (it needs the local outbox). |

Stop at the first step that touches an account that is not named `e2e-test-…` or `qa+…`. Clean-up: delete the test accounts. Result goes back into this document.

## Still not verified until H1 to H8 run

Real e-mail delivery and the content and expiry of the links; Supabase's own ban and session revocation; the access-token window; the hosted redirect from an e-mail link to `/set-password` and `/reset-password` (the stand-in produces the link shape the page expects, it does not prove the hosted template produces it).
