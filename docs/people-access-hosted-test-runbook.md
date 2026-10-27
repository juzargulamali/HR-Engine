# Hosted account-control test on V2: runbook (disposable accounts only)

Tests, against the **#50 preview** and **Enginious HR Engine_V2**: invitations, first-password setup, password reset, deactivate and reactivate, an already signed-in session after deactivation, unauthorised access, and **how long a deactivated account's old token still works against the data**. This is step H1 to H8 of [people-access-account-controls-verification.md](./people-access-account-controls-verification.md), made mechanical.

**Nothing here has been run.** The environment I work in cannot reach V2 or the preview, so **you** run each step and send me the results. Everything below is built so that a slip cannot touch a real person.

## Rules

* **V2 only, no new Supabase project, no setting changed** (not the token lifetime, not redirect URLs, not rate limits). The measurement observes; it never adjusts.
* **Only accounts whose address contains `e2e-test-`.** Every script that changes anything refuses any other address.
* **Your own account and every real staff account are not used, changed or opened.** The test System Administrator can *list* real accounts (any System Administrator can); never click one. Type `e2e-test` in the search box before you click anything.
* The two SQL scripts that read are read-only; the one that changes data changes one row set for one test account and refuses otherwise (tested, including its refusals).
* Never paste a password, a token or an e-mail link into a message to me. Send results only.

## 0. Minimum setup (about 15 minutes)

| Account | Address (you choose the mailbox) | Created how | Needs a mailbox? |
|---|---|---|---|
| **S**, test System Administrator | `<you>+e2e-test-admin@<domain>` | Supabase dashboard → Authentication → Users → **Add user → Create new user**, a password you generate, **Auto Confirm User ticked**. Then SQL step 2 below. | No (it never receives mail) |
| **P**, plain test employee | `<you>+e2e-test-p@<domain>` | **By the invitation in H1**, not by hand. | **Yes** |
| **Q**, second invitee | `<you>+e2e-test-invitee2@<domain>` | By the invitation in H2. | **Yes** |

That is the whole set: **one account made by hand, two made by the app.** No HR Admin test account: it would have to be given HR Admin on a real company, which would let a test account read real employee data. That case (an HR Admin is offered no account control) is proved by the unit tests and the local browser specs instead.

*Mailbox:* plus-addressing (`you+anything@domain`) delivers to `you@domain` with most providers, including Google Workspace and Microsoft 365 (if yours does not, use any inbox you own whose address still contains `e2e-test-`). Send yourself a test mail to the P address first. Do **not** use a public throw-away inbox: the invitation link signs the holder in as that account.

*E-mail volume:* V2's mail sender may allow only a few messages an hour. The test sends four (H1, H2 twice, H3). If one does not arrive, wait; do not repeat the action and do not change the limit.

## 1. Pre-flight

1. **Find the preview.** PR #50 on GitHub → the Vercel comment → **Preview**. It must include commit `a5a2b30` ("First-password setup…") or later; the comment shows the commit. If Vercel asks you to sign in, do.
2. **SQL step 1 (read-only).** V2 SQL Editor → `supabase/manual-sql/hosted_account_test_00_before_readonly.sql`. Send me the result. **Keep the hash in section D.** Section B must show no test accounts yet.
3. **Create S** in the dashboard (table above).
4. **SQL step 2 (one guarded change).** `supabase/manual-sql/hosted_account_test_10_grant_test_admin.sql`: edit the one address on the line marked `<<<` to S's address and run it. It refuses unless the address contains `e2e-test-`, matches exactly one account, is not linked to an employee and holds no role; otherwise it gives S the System Administrator role and marks it Active. The last table it prints must show S as `active` / `sys_admin`.
5. **Sign in to the preview as S.** If it works, the preview is bound to V2 (S exists nowhere else). *People & Access* appears in the menu. If sign-in fails, stop: the preview is not on V2.

## 2. The steps

Record each result in the sheet at the end.

**H1: invitation and first password (account P)**
1. As **S**: People & Access → *Invite a person* → name `E2E Test P`, address P → *Send invite*. Search `e2e-test`: P is listed as **Invited**. Open P → *Account*: *Resend invite* is offered and *Send password reset* is not.
2. The e-mail arrives (note: how long, sender, subject). **Do not click it.** Right-click the button → *Copy link address*.
3. In a checkout of this repository: `node packages/e2e-account-security/scripts/aim-auth-link-at-preview.mjs "<link>" https://<preview>`. It asks Supabase where the link leads, and prints the same destination on the preview. **Record where the e-mail link pointed** (the preview, or the production address): if it pointed at production, the e-mail was built from production's site address and only this script tests the preview's page.
4. Open the printed address in a **private window**. You see the *Welcome* page with a password form (not "invalid or has expired"). Try `short` first: refused with a reason. Then a good password: you land on the home page, signed in.
5. As **S**, reload P's *Account* tab: it must say **Active**. *(This is the "mark Active" fix: before it, a failed write there left P shown as Invited.)*
6. In a new private window sign in as P with that password: works.

**H2: resend invite (account Q)**
1. As S: invite Q. Do not accept. Open Q → *Account* → **Resend invite**. A second e-mail arrives.
2. Use the newer e-mail with the script and complete the form: Q becomes **Active**. If you kept the older e-mail's link, run it through the script too: record whether it still works.

**H3: administrator's password reset (account P)**
1. In a private window (browser **B**) sign in as P and stay on *Account & security*.
2. As S: P → *Account* → **Send password reset**. E-mail arrives; use the script on its link; set a **new** password.
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

**H7: delete, and leave no trace**
1. As S: delete **Q**, then **P** (*Account* → **Delete**, confirm). Each disappears from the list and cannot sign in. *(Order matters: an account an administrator deactivated points back at that administrator.)*
2. Dashboard → Authentication → Users: delete **S** last. If it refuses with a message about `status_changed_by` or a foreign key, a test account still exists: delete it first.
3. **SQL step 3 (read-only):** `supabase/manual-sql/hosted_account_test_95_after_readonly.sql`. Send me the result. It must show **0 test accounts, 0 test grants, the same System Administrators as before, and the same hash** as step 2 of pre-flight.

**H8: the automated specs.** **Not run on V2, by design.** They create accounts with the **service-role key** and give throwaway accounts the System Administrator role in whichever project they point at, and the package's own README forbids that against production. You asked for V2 with disposable accounts and no new project, and that would put a service-role key on your machine for no extra evidence: H1 to H7 cover the same behaviours by hand, and all 29 account-security specs pass against the local stack. If you want them run anyway, say so and I will give the exact, narrowed command.

## 3. Result sheet (fill in, send back)

| Step | Result | Notes |
|---|---|---|
| Pre-flight: preview on commit ≥ `a5a2b30`; S signs in (bound to V2) | | |
| H1: e-mail arrived (minutes) / link pointed at (preview or production) | | |
| H1: weak password refused; good password signs in; P shows **Active** | | |
| H2: resend arrives; Q becomes Active; older link works or not | | |
| H3: old password refused, new works, browser B signed out | | |
| H4: browser B sent to sign-in after deactivation (seconds); new sign-in refused (message) | | |
| H4: **RESULT block** (token lifetime; auth service; data API; refresh) | | |
| H5: check status Deactivated and blocked; after reactivation Active; P signs in | | |
| H6: P sees no People & Access, no controls | | |
| H7: SQL 95 clean (0 / 0 / same admins / same hash) | | |

## 4. Reading the token-window result (no change before we decide)

The application protects itself: it asks the auth service about the session on every page and action, so a deactivated person is turned away immediately (H4 step 4). The measurement answers the narrower question the application cannot: **can the old token, used directly against the data service, still read what row-level security allows that person?**

* **Data API refused at once:** nothing to do.
* **Data API accepted until the token expired:** the exposure is *at most the token lifetime*, and only to what that person could already read and change. The choices are to accept it, to shorten the lifetime in V2's Auth settings (a project setting, with the cost of more frequent refreshes), or to add a check in the database for deactivated accounts. **None of these is made on an assumption; we choose after reading your numbers.**
* **Refresh issued a new token after deactivation:** that would be a different and more serious finding; tell me at once.

## 5. If something goes wrong

* **You acted on a real account by mistake:** stop and tell me. *Reactivate* (with a reason) reverses a deactivation; nothing the test does deletes a real record; the audit trail keeps what happened.
* **An e-mail never arrives:** wait; do not repeat. The mail limit is a V2 setting that stays as it is.
* **The script says the token is not accepted before deactivation:** stop; P is not Active or the key or password is wrong.
