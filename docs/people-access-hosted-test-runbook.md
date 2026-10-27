# Hosted account-control test on V2 / Production: runbook (existing test administrator, disposable invitees only)

> **STATUS: PARTIALLY RUN (2026-10-27).** The short path was run on Production after #50 merged, with `hrtest.admin@enginious.ae` (preserved) and one disposable invitee; the observations and the identical before/after fingerprints are recorded in [people-access-account-controls-verification.md](./people-access-account-controls-verification.md) under "Hosted results (Production)". **Not verified, and still open:** the H4 token-window measurement (direct-data access of a deactivated account's old token), H2 resend invitation, H6 the plain-account unauthorised view, the other-session part of H3, and link detail. To close any of them, repeat only that step with a fresh disposable `e2e-test-` invitee and take new before/after fingerprints with the two read-only SQL scripts. PR #51 (the security migration) is separate; **no hosted SQL is applied here or for #51 in the meantime**.

Tests, against **Production (V2)**: invitations, first-password setup, password reset, deactivate and reactivate, an already signed-in session after deactivation, unauthorised access, and **how long a deactivated account's old token still works against the data**. This is step H1 to H8 of [people-access-account-controls-verification.md](./people-access-account-controls-verification.md), made mechanical.

**It is a real production system.** The only things the test creates or acts on are the disposable invitees; the only real account it signs in with is your own test administrator, which is not changed. Production already served the old account screens before the merge; the first thing the test proves is that the moved controls work there.

**Short path** (about 20 minutes of your time plus one waiting period): pre-flight, H1, H3, H4, H5, H6, H7. **H2 (resend invite) is optional**: do it if time allows; it needs the second invitee Q and two more e-mails.

**The test administrator is your existing account `hrtest.admin@enginious.ae` ("S").** It is used to sign in and to perform the invitations; it is **never created, granted anything, reset, deactivated, deleted or otherwise changed**. Only the two new disposable invitees (P and Q) are ever invited, reset, deactivated, reactivated or deleted.

## Rules

* **V2 only, no new Supabase project, no setting changed** (not the token lifetime, not redirect URLs, not rate limits). The measurement observes; it never adjusts.
* **`hrtest.admin@enginious.ae` is preserved exactly.** No SQL in this runbook changes it or any role; the before and after checks fingerprint its account and **every role row it holds** and the after-check must match. Do not change its password, do not use *Sign out of all devices* on it, and do not use it on any person other than P and Q. (It cannot deactivate, reset or delete itself in the app anyway.)
* **Only accounts whose address contains `e2e-test-` are ever acted on:** P and Q, created by the invitations below. The measurement script refuses any other address.
* **Real staff accounts are not used, changed or opened.** A System Administrator can *list* every account; never click one. Type `e2e-test` in the search box before you click anything.
* **All three SQL scripts are read-only.** Nothing in this test writes to V2 by hand.
* Never paste a password, a token or an e-mail link into a message to me. Send results only.

## 0. Minimum setup (about 5 minutes)

| Account | Address | Created how | Needs a mailbox? |
|---|---|---|---|
| **S**, test System Administrator | `hrtest.admin@enginious.ae` (**exists; not touched**) | already exists | no (you sign in with its password, in a private window) |
| **P**, plain disposable employee | `<you>+e2e-test-p@<domain>` | by the invitation in H1 | **yes** |
| **Q**, second disposable invitee | `<you>+e2e-test-invitee2@<domain>` | by the invitation in H2 | **yes** |

That is the whole set: **nothing is created by hand, and no SQL changes anything.** There is no HR Admin test account: it would have to be given HR Admin on a real company, which would let a test account read real employee data. That case (an HR Admin is offered no account control) is proved by the unit tests and the local browser specs instead.

*It must be a System Administrator.* The test needs `hrtest.admin@enginious.ae` to hold the System Administrator role for all companies, because the account controls only appear for that role. Pre-flight step 2 shows every role it holds and says **STOP** if that one is missing. **I will not grant it for you:** if it says STOP, tell me and we decide together (for example, use a different existing administrator).

*Mailbox:* plus-addressing (`you+anything@domain`) delivers to `you@domain` with most providers, including Google Workspace and Microsoft 365 (if yours does not, use any inbox you own whose address still contains `e2e-test-`). Send yourself a test mail to the P address first. Do **not** use a public throw-away inbox: the invitation link signs the holder in as that account.

*E-mail volume:* V2's mail sender may allow only a few messages an hour. The test sends four (H1, H2 twice, H3). If one does not arrive, wait; do not repeat the action and do not change the limit.

## 1. Pre-flight

1. **Confirm Production serves the merge.** Vercel → the project → Deployments: the latest **Production** deployment must be on the merge commit of #50 (I give you its hash after the merge) and *Ready*. The proof inside the app is step 3: *People & Access* exists only in the merged version.
2. **SQL step 1 (read-only).** V2 SQL Editor → `supabase/manual-sql/hosted_account_test_00_before_readonly.sql`. Send me the result and **keep two values**: the **role fingerprint** (section C) and the **hash** (section E). Check: section B shows no disposable accounts; section C says *exactly one account*, status *active*, lists the roles `hrtest.admin@enginious.ae` holds, and says **OK** on *holds the System Administrator role*. Any **STOP**: do not continue.
3. **Sign in to Production as S** (`hrtest.admin@enginious.ae`, in a private window). *People & Access* appears in the menu: that is the merged version. If it does not, stop: the deployment is not the merge yet.

## 2. The steps

Record each result in the sheet at the end.

**H1: invitation and first password (account P)**
1. As **S**: People & Access → *Invite a person* → name `E2E Test P`, address P → *Send invite*. Search `e2e-test`: P is listed as **Invited**. Open P → *Account*: *Resend invite* is offered and *Send password reset* is not.
2. The e-mail arrives (note: how long, sender, subject). **Do not click it.** Right-click the button → *Copy link address*.
3. **Click the button in the e-mail** (it goes to Supabase, then to the Production site's set-password page). **Record where it landed.** If it lands anywhere other than the Production address's `/set-password`, stop and tell me; the fallback helper `scripts/aim-auth-link-at-preview.mjs` re-aims a link, but it should not be needed on Production.
4. Do this in a **private window**. You see the *Welcome* page with a password form (not "invalid or has expired"). Try `short` first: refused with a reason. Then a good password: you land on the home page, signed in.
5. As **S**, reload P's *Account* tab: it must say **Active**. *(This is the "mark Active" fix: before it, a failed write there left P shown as Invited.)*
6. In a new private window sign in as P with that password: works.

**H2 (optional): resend invite (account Q)**
1. As S: invite Q. Do not accept. Open Q → *Account* → **Resend invite**. A second e-mail arrives.
2. Click the newer e-mail's button and complete the form: Q becomes **Active**. If you kept the older e-mail, try its button too: record whether it still works.

**H3: administrator's password reset (account P)**
1. In a private window (browser **B**) sign in as P and stay on *Account & security*.
2. As S: P → *Account* → **Send password reset**. E-mail arrives; click its button (private window); set a **new** password.
3. Expect: the old password is refused at sign-in; the new one works; in browser B the next click goes to the sign-in page (other sessions are ended).

**H4: deactivate, an already signed-in session, and the token window (account P)**
1. Browser B: sign in as P (new password), stay on *Account & security*.
2. In a terminal, from `packages/e2e-account-security` (**the anon key is public by design**: dashboard → Project Settings → API → *anon public*; the password is P's):
   ```
   SUPABASE_URL=https://<project>.supabase.co  SUPABASE_ANON_KEY=<anon public key> \
   P_EMAIL=<P address>  P_PASSWORD=<P password>  node scripts/measure-token-window.mjs
   ```
   It signs P in once, prints when that token expires and its lifetime, checks it is accepted, then asks you to deactivate P.
3. As S: P → *Account* → **Deactivate**, type a reason; wait for the page to say **Deactivated**; **immediately press ENTER** in the terminal.
4. Browser B: click any link or reload. Expect the sign-in page. Note how long after deactivation. In another private window try to sign in as P: expect it refused (note the message).
5. **Leave the script running until it finishes** (about an hour if the lifetime is 60 minutes; it stops itself a minute after the token expires). It asks, every 30 seconds, whether the auth service and the data API still accept the old token, and whether it can still get a new one. It reads only P's own profile row and one row of the directory every signed-in person can read; it writes nothing. Send me the **RESULT** block it prints. **Do not change any setting while or after; the decision comes after we both read the result.**

**H5: reactivate and the consistency check (account P)**
1. As S: P → *Account* → **Check status**: expect it to say the account is Deactivated and actually blocked.
2. **Reactivate**, with a reason. **Check status** again: Active and not blocked.
3. P signs in with the password in a private window: works.

**H6: unauthorised view (account P)**
Signed in as P (Active, no role): there is **no** People & Access entry in the menu; `/people-access` says there is nothing to manage; `/admin/users` leads there; no *Invite a person* panel; no account control anywhere.

**H7: delete the two disposable accounts, and prove nothing else changed**
1. As **S**: delete **Q** (if you made it), then **P** (*Account* → **Delete**, confirm). Each disappears from the list and cannot sign in. **Do not delete or change S**: it stays exactly as it was.
2. **SQL step 2 (read-only):** `supabase/manual-sql/hosted_account_test_95_after_readonly.sql`. Send me the result. It must show: **0 disposable accounts and 0 of their role grants; S still found, still Active, still a System Administrator; the role fingerprint equal to the one you kept; the same other System Administrators; and the same hash** as pre-flight step 2.

**H8: the automated specs.** **Not run on V2, by design.** They create accounts with the **service-role key** and give throwaway accounts the System Administrator role in whichever project they point at, and the package's own README forbids that against production. You asked for V2 with only the invitees as disposable accounts and no new project, and that would put a service-role key on your machine and grant roles to throwaway accounts: H1 to H7 cover the same behaviours by hand, and all 29 account-security specs pass against the local stack. If you want them run anyway, say so and I will give the exact, narrowed command.

## 3. Result sheet (fill in, send back)

| Step | Result | Notes |
|---|---|---|
| Pre-flight: Production on the merge commit; S (`hrtest.admin@enginious.ae`) holds System Administrator (OK); S signs in and sees People & Access | | |
| H1: e-mail arrived (minutes) / link landed on the Production set-password page | | |
| H1: weak password refused; good password signs in; P shows **Active** | | |
| H2 (optional): resend arrives; Q becomes Active; older link works or not | | |
| H3: old password refused, new works, browser B signed out | | |
| H4: browser B sent to sign-in after deactivation (seconds); new sign-in refused (message) | | |
| H4: **RESULT block** (token lifetime; auth service; data API; refresh) | | |
| H5: check status Deactivated and blocked; after reactivation Active; P signs in | | |
| H6: P sees no People & Access, no controls | | |
| H7: P and Q deleted; SQL 95: 0 disposable accounts, S preserved (Active, System Administrator), **role fingerprint equal**, same other administrators, **same hash** | | |

## 4. Reading the token-window result (no change before we decide)

The application protects itself: it asks the auth service about the session on every page and action, so a deactivated person is turned away immediately (H4 step 4). The measurement answers the narrower question the application cannot: **can the old token, used directly against the data service, still read what row-level security allows that person?**

* **Data API refused at once:** nothing to do.
* **Data API accepted until the token expired:** the exposure is *at most the token lifetime*, and only to what that person could already read and change. The choices are to accept it, to shorten the lifetime in V2's Auth settings (a project setting, with the cost of more frequent refreshes), or to add a check in the database for deactivated accounts. **None of these is made on an assumption; we choose after reading your numbers.**
* **Refresh issued a new token after deactivation:** that would be a different and more serious finding; tell me at once.

## 5. If something goes wrong

* **You acted on a real account by mistake:** stop and tell me. *Reactivate* (with a reason) reverses a deactivation; nothing the test does deletes a real record; the audit trail keeps what happened.
* **The audit trail:** the invitations, resets and the deactivation of P are recorded in the audit log with `hrtest.admin@enginious.ae` as the actor. That is kept on purpose; it is the only trace the test leaves on S.
* **An e-mail never arrives:** wait; do not repeat. The mail limit is a V2 setting that stays as it is.
* **The script says the token is not accepted before deactivation:** stop; P is not Active or the key or password is wrong.
