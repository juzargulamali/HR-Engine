# People & Access: invites, Resend invite and password links

**Scope.** How a person gets from an emailed link to a password: Invite, Resend invite, Send password reset (administrator) and Forgot password (the person). Written 2026-11-12 when the links were fixed. The rest of the Account tab has no per-control reference yet (`docs/people-access-account-controls-verification.md` is an older input).

**Release status (four facts kept apart, reconciled 2026-11-12 after the merge).** **Merged:** yes. PR #91 merged into `main` with merge commit `0b72962d5faa4b55d83a23d7fcfb7e76457d7396`, pinned to head `0bee73284685d630c9376010dfc74d5276e81b09` (checked on GitHub), at the owner's request and before the real-inbox test. **Required CI on the exact head:** `lint-typecheck-test` and `rls-policies` both passed on `0bee732` (read on GitHub by Claude before the merge). **Hosted database:** no migration and no SQL. **Real-inbox test: pending.** The owner will run it in Production after deployment (Invite, Resend invite for an account that never set a password, Send password reset, Forgot password; admin-triggered emails opened in a different browser). No Preview test was run. **Production:** not verified. Claude cannot read Vercel, the hosted Auth users or the Auth logs, and saw nothing signed in. App only: no change to Supabase Auth settings, and no change to who may invite or reset. Everything said about the hosted project below is `Unverified` unless marked owner-reported. *(History: before the merge this line said "Not merged".)*

Sources, read at the branch head:

* U `apps/web/src/lib/actions/users.ts` (`inviteUser`, `resendInvite`)
* A `apps/web/src/lib/actions/account-status.ts` (`adminSendPasswordReset`)
* P `apps/web/src/lib/actions/password.ts` (`requestPasswordReset`)
* EL `apps/web/src/lib/supabase/email-link.ts` (the client that asks for the email)
* L `apps/web/src/lib/auth/email-link.ts` (what a link brought back in the address)
* F `apps/web/src/components/auth/password-reset-form.tsx` (`/set-password`, `/reset-password`)
* LF `apps/web/src/app/login/email-link-forwarder.tsx`
* X `apps/web/src/proxy.ts` (public pages: `/login`, `/set-password`, `/forgot-password`, `/reset-password`)

## 1. The four ways a link is sent

| Control | Who | What is sent | Lands on |
|---|---|---|---|
| **Invite** (People & Access) | System Administrator | Supabase's invite email, asked for with the service key (U `inviteUser`) | `/set-password` |
| **Resend invite** (People & Access) | System Administrator | Supabase's password email (an invite cannot be sent twice) (U `resendInvite`) | `/set-password` |
| **Send password reset** (Account tab) | System Administrator | The same password email (A) | `/reset-password` |
| **Forgot password?** (sign-in page) | Anyone, for their own address | The same password email; the answer is the same whether or not the address has an account (P) | `/reset-password` |

The address the link returns to is `NEXT_PUBLIC_SITE_URL` plus the page. Supabase uses it only if it is on the project's allowed redirect list; otherwise it sends the person to the project's Site URL, which is the home address (`.env.example`).

## 2. The two faults fixed on 2026-11-12

**2.1 "This link is invalid or has expired" on every Resend invite, Send password reset and Forgot password link.** The three password emails were asked for with the signed-in session client. That client always uses the flow in which the link comes back as `?code=...` and can only be completed by the browser that asked for it (the secret half is kept in that browser's cookies). The pages that receive the link read only the session after `#`, and for Resend invite and Send password reset the asking browser is the administrator's, never the recipient's. So the link failed however fresh it was. Shown by test on the request each client sends (`lib/supabase/email-link.test.ts`): the session client sends a code challenge and writes a verifier cookie; the email-link client sends neither. The invite itself was not affected: it is asked for with a different client.

*Fix:* the three emails are asked for with EL, a client that uses the plain flow, keeps no session and writes no cookie. The link then carries the session after `#`, which the pages already read. The public key only: it can ask for an email and nothing else; who may ask is still decided by each action first.

**2.2 A link that opened the sign-in page.** When Supabase falls back to the Site URL (section 1), the link lands on the home address with its session after `#`; the home address needs a sign-in, so the person saw the sign-in page and the link was spent. This is what happens to an invite sent from a deployment whose address is not on the allowed list, such as a Preview. `Unverified` on hosted: the allowed list and the Preview's `NEXT_PUBLIC_SITE_URL` were not seen.

*Fix:* the sign-in page passes such a link on (LF): an invite to `/set-password`, a password reset to `/reset-password`, with the session still in the address. This works when the fallback address is this app. An invite link is still good for one use only.

## 3. What the receiving pages say

| What the address holds | Page says | Source |
|---|---|---|
| The session after `#` | The password form. The session is removed from the address at once | F, L `readEmailLink` |
| An error saying the link is used or too old (`otp_expired`) | "This link has already been used or has expired. A link works once, and some email systems open it before you do." and what to do next | F, L `isUsedOrExpired` |
| `?code=...` (a link sent before the fix) | "This link cannot be finished here. It was made in a way that only works in the browser that asked for it." and what to do next | F |
| Nothing | "This link is invalid or has expired." and what to do next | F |
| On the sign-in page, a used or expired link | "That link has already been used or has expired. A link works once. If you have set a password, sign in below; otherwise press Forgot password to get a new link." | LF |

Setting the password marks the account Active (unchanged; F `markActive`). The employee record, HR roles and module access are not touched by any of these.

## 4. Nothing is logged

The address, the session in it and the email's link are never written to a log, an audit entry or an error message. The audit entries are the existing ones and carry the action and the account only (`invitation_resent`, `password_reset_sent_by_admin`, `password_reset_requested`, `password_changed`). The tests use made-up placeholders.

## 5. Limits and what was not verified

* **Not reproduced against Supabase Auth.** The local stack uses an in-repo stand-in for sign-in, not Supabase Auth, and Claude has no access to the hosted project. The fault in 2.1 is shown on the request the app sends; what Supabase does with it (a `?code=` link) is its documented behaviour, not observed here. A signed-in check with a test account is still needed.
* **Email scanners.** Some mail systems open links before the person does, which spends a one-use link. That would also read as expired, and only the hosted Auth log can show it (a verification recorded before the person clicked). The fix does not change it.
* **A link sent before the fix** still fails; a new one must be sent after deployment.
* **The allowed redirect list and the email templates** are shared Auth settings and were not changed.

## 6. Tests

| File | What it shows |
|---|---|
| `lib/supabase/email-link.test.ts` (2) | The session client asks for a code only the asking browser can exchange and stores the secret in its cookies; the email-link client asks for a plain link and writes no cookie |
| `lib/auth/email-link.test.ts` (6) | Every shape an address can hold; where a stray link belongs |
| `app/login/email-link-forwarder.test.tsx` (4) | An invite and a reset are passed on with the session; a used link is explained and cleared from the address; an ordinary visit does nothing |
| `components/auth/password-reset-form.test.tsx` (4 added) | Working link, used link, older `?code=` link, empty address |
| `lib/actions/users.test.ts`, `lib/actions/password.test.ts` (new, 3), `lib/actions/account-status.test.ts` | The three emails are sent with the email-link client and never with the session client; refusals reach no service |
