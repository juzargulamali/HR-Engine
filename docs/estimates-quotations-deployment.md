# Estimates & Quotations (part 1): deployment

One migration, applied by the owner in the SQL Editor of the hosted project. Claude runs no hosted SQL. Additive and idempotent (safe to run twice). It needs the Clients & Agencies migration (`20261219000100`) first, because it replaces five of that migration's functions (same behaviour plus the two identifier columns). The same migration also carries what part 2 (PDF and Excel export) needs: the exports render `crm_quotation_snapshots.content`, whose pictures are pinned copies (private bucket `quotation-assets`); the migration is not applied anywhere yet, so it was corrected in place rather than adding a second one.

| Order | File | Kind |
|---|---|---|
| 1 | `supabase/manual-sql/crm_quotes_00_preflight_readonly.sql` | read-only: every section B row must say OK, the last one "not applied yet". Section C is information (companies without Sales settings cannot start an estimate; companies with no legal name cannot issue) |
| 2 | `supabase/manual-sql/crm_quotes_05_preservation_check_readonly.sql` | read-only: keep the result |
| 3 | `supabase/migrations/20261220000100_crm_estimates_quotations.sql` | the change (writes) |
| 4 | `supabase/manual-sql/crm_quotes_05_preservation_check_readonly.sql` again | read-only: identical to step 2 (the migration only adds; it changes no proposal, approval, file, organisation or company value) |
| 5 | `supabase/manual-sql/crm_quotes_20_verify_readonly.sql` | read-only: every row must say OK (RLS on, no write grants for signed-in users, functions present, guard triggers present, private logo and `quotation-assets` buckets, the approval functions and `crm_approvals.quote_content_hash`, every company has standard terms and VAT choices; one INFO row says whether the pinned-asset delete guard on `storage.objects` could be installed) |
| rollback | `supabase/manual-sql/crm_quotes_90_rollback.sql` | writes; refuses while any issued quotation exists; keeps the identifier and issuer columns and the replaced functions (see the header of the file) |

## What it adds, and why a new table is needed

The quotation is not a second record: **every quotation is a `crm_proposals` row** (its version number, its status `draft/sent/superseded/accepted`, its commercial approval and its recorded "sent" fact are the existing ones). A proposal row can hold only a note and a file, so it cannot hold a priced bill of quantities (sections, lines, currency, VAT, bill-to, milestones, terms). `crm_quotations` is therefore a 1:1 extension of the proposal row, with `crm_quotation_sections`, `crm_quotation_lines` and the frozen `crm_quotation_snapshots`.

* **Client identifiers**: `crm_organisations.vat_trn`, `trade_licence_no` (text, trimmed, leading zeros kept, at most 40 characters). Replaced functions: `crm_create_organisation_profile` (two trailing arguments, old signature dropped), `crm_update_organisation`, `crm_import_fingerprint`, `crm_import_apply_item` (fill-only for the two columns).
* **Issuer details**: `companies.trn`, `address`, `phone`, `email`, `website`, `logo_path` (the legal name already existed); private bucket `company-logos`; `crm_set_company_logo` (System Administrator only). Edited on Admin, Companies (existing `companies_write` policy: System Administrator).
* **Estimates**: tables above plus `crm_quote_counters` (reference `QUO-<company code>-<year>-<nnnn>`, same pattern as the enquiry counter), `crm_quote_vat_choices` (seeded per company: Out of scope, 0%, 5%, 15%, 23%; nothing is a default), `crm_quote_terms_templates` (seeded per company with the six working-draft clauses). Functions: `crm_quote_create`, `crm_quote_save_header`, `crm_quote_save_section`, `crm_quote_delete_section`, `crm_quote_save_line`, `crm_quote_delete_line`, `crm_quote_reorder`, `crm_quote_issue`, `crm_quote_create_revision`, `crm_save_vat_choice`, `crm_save_terms_template`, and `crm_remove_file` (one added refusal: a picture used by an issued quotation cannot be removed).

## Rules (all enforced in the database)

* Edit, create, reorder and issue: the enquiry owner or a Sales founder (`crm_require_owner_or_founder`, the existing proposal rule), company scoped. Others are refused by the functions; tables are SELECT-only for people with a grant for that company.
* Issue needs: issuer legal name, currency, VAT choice, bill-to organisation, at least one item and no empty section, a validity date not in the past if given, consistent milestones (percentages add to 100 or amounts to the total incl. VAT). A draft can be saved incomplete.
* Approval: the existing commercial approval, **bound to the exact version reviewed**. `crm_quote_content_hash` fingerprints everything client-facing (never internal notes, never the day). With the company policy `required`: `crm_quote_request_approval` records the hash (and withdraws a waiting request for an older version); a founder approves through `crm_quote_decide_approval`, which needs the hash the reviewer screen was rendered with, equal to the current one (otherwise: "This quotation changed after you opened it ..."); a trigger on `crm_approvals` refuses to approve a quotation approval any other way; `crm_quote_issue` needs an `approved` approval whose bound hash equals the current hash, so any edit after the request or the decision needs a fresh approval. `crm_request_approval` / `crm_decide_approval` are unchanged for every other proposal. `not_required` and `not_configured` do not gate issuing (they never gated proposals).
* Pinned pictures: at issue the server copies the company logo and each item picture to immutable, content-addressed objects owned by the revision (`quotation-assets/<proposal>/<logo|line-<id>>-<sha256>.<ext>`, made before `crm_quote_issue(p_proposal, p_assets)`); the function refuses an issue whose assets are not pinned and records only the pinned paths and hashes in the snapshot. A trigger on `storage.objects` (installed only where the migration role may add it; the verify pack reports which) refuses to rename or delete a pinned object while its revision exists; the bucket has no policy for signed-in roles. **Verified on an isolated local Supabase stack with real Storage; hosted V2 is not yet verified** (see "Local release check" below). Check on the hosted project after applying.
* Display numbers 1, 1.1, 1.2, 2.1 (`lineDisplayNumber` in `packages/domain`, mirrored by `crm_quote_build_content`) and a separate `crm_quotations.exclusions` list (empty by default; copied to revisions; its own block in the snapshot, before the terms).
* Freeze: issuing builds the client-facing snapshot inside the database. Guard triggers refuse any change to the snapshot (even by a table owner) and to the header, sections and lines of an issued quotation. A revision is a new draft (same reference, revision + 1); issuing it marks earlier draft or sent revisions `superseded` without altering them.
* Internal notes live only in `crm_quotations.internal_notes`; they are never copied to the snapshot. There is no costing, supplier price or margin anywhere.

Tests: `packages/rls-tests/test/crm-quotations.rls.test.ts` (also runs pack files 00, 05, 20 and refuses the rollback while issued quotations exist), `packages/domain/test/quotations.test.ts`, `apps/web/src/lib/crm/quotations/model.test.ts`, `apps/web/src/lib/actions/quotations.test.ts`. Control reference: `docs/enginious-os/modules/sales-estimates-and-quotations.md`.

## Local release check (isolated Supabase stack with real Storage)

Run on a throwaway local Supabase stack in Docker (its own project id, ports and fresh volumes, fictional data only, Storage enabled; the app, the SQL connection and the Storage endpoint were each confirmed to be loopback addresses of that stack before every major step). **Hosted V2 was not touched and is not yet verified.** Nothing was sent, deployed or merged.

| Item | Tested commit |
|---|---|
| Estimates & Quotations (this branch) | `f90c915` |
| Existing CRM compatibility (account creation, profile edit, Excel import, enquiry and proposal flow) | `2fef1f1` (`main` at that time). This is the commit that was built and tested; it is **not** asserted to be the commit Vercel Production is serving (Vercel Production status is unverified) |

Result:
* Baseline: all migrations up to `20261219000100` applied; then the owner pack for this migration: preflight all OK, migration applied, verify pack 61 rows all OK, preservation check identical before and after.
* The pinned-asset delete guard on `storage.objects` **was installed** (the migration role is not a superuser, as on hosted; the table is owned by the Storage service role).
* Current `main` code (`2fef1f1`) on the migrated database: account creation, profile edit, Excel import (preview, confirm, re-upload creates nothing), the enquiry page and the existing proposal flow all passed, so the migration is backward compatible with that code.
* This branch (`f90c915`): logo and item-photo upload to real Storage, quotation built, approval requested and given, issued; PDF and Excel downloaded through the buttons. The pinned copies in `quotation-assets` have SHA-256 values matching the snapshot and the source files. After the company logo was replaced, re-exporting the same revision still showed the **original logo and item photo** in both files. **Totals match** in the PDF, the Excel file and the snapshot (4,800.50, VAT 240.03, total 5,040.53). The internal-notes marker is absent from both files.
* **Deleting a pinned asset is refused**: service role single delete, bulk delete and move: HTTP 500 with database code 55000; a signed-in user's single delete: 400 AccessDenied; a signed-in user's bulk delete: 200 with an empty list (nothing deleted); a SQL delete or update: "A pinned quotation asset cannot be renamed or deleted". Both pinned objects stayed with their hashes intact.

At the time of this local check these still needed hosted verification. Per the owner the migration is now applied on hosted V2, the verification rows were OK and the guard is installed (see "Hosted V2 result (migration `20261220000100`)" below). Still open: Supabase Auth and e-mail behaviour (the local check used admin-created users); the hosted Postgres major version (the local stack ran 17); the approval-policy screen in Sales settings (the policy was set by SQL locally, the screen was not exercised).

## Hosted V2 result (migration `20261220000100`, owner-reported; Claude ran no hosted SQL)

The owner applied `20261220000100_crm_estimates_quotations.sql` on hosted V2 using the owner pack in the order above and reported (2026-11-08): **all five preservation fingerprints matched** (step 4 identical to step 2), **every verification row was `OK`**, and **the pinned-asset delete guard on `storage.objects` is installed**. The result rows themselves were not pasted into the repository and were not re-read by Claude. This is distinct from the local release check above, which Claude ran on an isolated Supabase stack.

PR #62 was merged at its pinned head `6c29dfe8108e2c6b6acfe8b2e7b1235b9f49191e` (merge commit `37796fd9e7759fbc413c71179646820cd225ea91`) after required CI (`lint-typecheck-test`, `rls-policies`) was green on that exact head. Nothing was deployed by Claude and no quotation was issued or sent. Vercel Production status for this merge, or for any later commit, is not verified by Claude.

Still not verified by any run: Supabase Auth and e-mail behaviour of a hosted journey, the approval-policy screen in Sales settings on hosted V2, and a real issued estimate with a logo and item photo on hosted Storage (the issue, export and delete-refusal journey was tested only on the isolated local stack).

## Estimates-only change (branch `feat/estimates-only`)

The app part of this change needs no migration: the wording (Estimate everywhere), a simpler three-step builder, the mandatory budgetary notice in both files, no standard terms or acceptance wording in client files, larger aspect-preserving photos, a boxed totals block, and "record as sent" refused for estimate rows in the app. The applied migration `20261220000100_crm_estimates_quotations.sql` is **unchanged** (hosted V2 has it applied). Existing `QUO-` quotations and their frozen snapshots are not rewritten and export exactly as issued (a snapshot without the server-written marker `estimate-format:1` is treated as historical).

The two follow-ups that were first left as owner decisions are now delivered as ONE additive, idempotent migration, `20261221000100_crm_estimates_only_guards.sql`, with its own owner pack (next section): the database refuses an estimate being recorded as sent, and new estimates get the `EST-` prefix. **Not applied anywhere yet.**

Evidence at `158740c` (app): unit and export tests including a pre-change frozen fixture, and a local-stack browser flow (`apps/web/os-shell-checks/quotations-flow.mjs`) proving that finalising writes no booking, reservation, follow-up, reminder or Zoho row and changes no status or stage. **Not verified:** any hosted behaviour of this change, Vercel, real object storage for this change.

## Estimates-only database guard (owner-run)

**What it does.** (1) Database refusal: an estimate (a `crm_proposals` row that has a `crm_quotations` row; every estimate and legacy quotation is one) can never be recorded as `sent`. A BEFORE INSERT OR UPDATE OF `status` trigger on `crm_proposals` (`crm_proposals_estimate_sent_guard`, function `crm_estimate_sent_guard`) raises SQLSTATE `EST01`: "An estimate cannot be marked as sent. Send official quotations from the Zoho Books workflow." It also stops a direct call of `crm_set_proposal_status` by the enquiry owner or a founder. `crm_set_proposal_status` is **not rewritten**; because a call is one transaction, the refusal rolls back its side effect (superseding the proposal really sent to the client), so an estimate can never unlock the Proposal sent stage (needs a sent proposal) or move to Quote sent (needs the Zoho Books quote reference). Not blocked: finalising a revision superseding earlier draft or sent revisions (including a legacy quotation that was already sent), withdrawing (`superseded`), any update that leaves `status = 'sent'` unchanged (legacy rows already sent stay as they are), unrelated column updates, and every ordinary note-and-file proposal. (2) `crm_quote_create` is replaced with the identical body except the reference prefix: new estimates are `EST-<company code>-<year>-<nnnn>`. The yearly counter is the SAME one as for `QUO-`, so `EST-` continues the sequence and no number repeats; a revision copies the reference of the revised estimate, so a revision of `QUO-...` stays `QUO-...` and a revision of `EST-...` stays `EST-...`. Privileges of `crm_quote_create(uuid)` are unchanged.

**Order** (SQL Editor of the V2 project; Claude runs no hosted SQL; only the migration and the rollback change the database):

| Order | File | Kind and what it must say |
|---|---|---|
| 1 | `supabase/manual-sql/crm_estguard_00_preflight_readonly.sql` | read-only. Every section B row must say OK and the row "applied already?" must say "OK - not applied yet"; the row "crm_quote_create currently generates the old QUO- reference" must say OK. Section C is information: estimate rows by status, how many estimate rows are ALREADY sent (they stay as they are), how many are accepted, the highest reference per prefix and company code, ordinary proposals recorded as sent |
| 2 | `supabase/manual-sql/crm_estguard_05_preservation_check_readonly.sql` | read-only. Keep the result (snapshot) |
| 3 | `supabase/migrations/20261221000100_crm_estimates_only_guards.sql` | CHANGES the database (adds one trigger and function, replaces `crm_quote_create`). Safe to run twice |
| 4 | `supabase/manual-sql/crm_estguard_05_preservation_check_readonly.sql` again | read-only. Compare with step 2 row by row: identical EXCEPT the row `crm_quote_create (INTENDED TO CHANGE)` and the row "estimate guard trigger ... (INTENDED TO CHANGE)" (0 before, 1 after). Function fingerprints of `crm_set_proposal_status`, `crm_quote_issue`, `crm_quote_create_revision`, `crm_move_stage`, the approval functions, and the row counts and hashes of proposals (status, version, sent_on), quotation references, snapshots, counters, Zoho references and enquiries (stage, version) must be identical |
| 5 | `supabase/manual-sql/crm_estguard_20_verify_readonly.sql` | read-only. All 14 rows must say OK (trigger present, enabled, row-level BEFORE for insert and update of status; guard function not callable by signed-in users; `crm_quote_create` generates EST-, same counter, still SECURITY DEFINER; grants unchanged; `crm_set_proposal_status` not rewritten). It creates no estimate; it reads definition text |
| rollback | `supabase/manual-sql/crm_estguard_90_rollback.sql` | CHANGES the database. Drops the trigger and function and restores the exact previous `crm_quote_create` (new estimates are `QUO-` again). It does **not** rename EST- estimates already created: they keep their reference, and their revisions keep it. A notice reports how many exist. Safe to run twice. The app still refuses "record as sent" for estimates |

**Send back:** the full results of steps 1, 4 (with step 2) and 5; and, when you run it, the notice of the rollback.

**Compatibility with the deployed app.** The app can be released before or after the migration. Before: the app refuses "record as sent" for an estimate itself and new estimates are still `QUO-`. After (old app): the same screens work; a direct database refusal would be shown with its message if the app ever sent the call (it does not for estimates; the check fails closed). The new app reads references as text and never parses the prefix, file names follow the reference (`EST-...-rev1.pdf`), so both prefixes export correctly. Order does not matter for correctness.

**Owner decision still open: `accepted`.** The guard only refuses `sent`. An estimate can reach `accepted` only from `sent`, so after this change a NEW estimate can never become `accepted`; a legacy quotation recorded as sent before this change can still be recorded as accepted (history is not rewritten). If "nothing may imply acceptance" should also stop that, a follow-up would refuse `accepted` for estimate rows in the same trigger; it is not done here because it would change historical records' next step.

**Rehearsal on a throwaway local database** (the RLS suite does exactly this, `packages/rls-tests/test/crm-estimates-only-guards.rls.test.ts`): estimates migration applied and a real legacy quotation created and recorded as sent with the OLD function; preflight; snapshot; guard migration applied; verify (14 of 14 OK); snapshot compared (only the two intended rows differ); migration applied a second time (no change); rollback run twice (trigger gone, `crm_quote_create` fingerprint equals the pre-migration one, EST- estimates untouched, grants unchanged); re-applied; verify OK. Hosted V2: **not applied, not verified.**

Evidence at `158740c`: unit and export tests including a pre-change frozen fixture, and a local-stack browser flow (`apps/web/os-shell-checks/quotations-flow.mjs`) proving that finalising writes no booking, reservation, follow-up, reminder or Zoho row and changes no status or stage. **Not verified:** any hosted behaviour of this change, Vercel, real object storage for this change. Optional later migrations (owner decision, not required): `EST-` reference prefix (`create or replace function crm_quote_create`), and a database-level refusal of `crm_set_proposal_status('sent')` for a version that has a `crm_quotations` row.

### Hosted V2 result (owner-reported; Claude ran no hosted SQL)

The owner ran this pack on hosted V2 (2026-11-08) and reported: the preservation comparison passed and **all 14 verification checks were OK**. The result rows were not pasted into the repository and were not re-read by Claude, and the rollback was not run. PR #64 was merged at its pinned head `64682cd76056fb60b541b23c9d28fcdc0c68492b` (merge commit `02fe2df2a6238184e493ffe8322660045a055a22`) after required CI (`lint-typecheck-test`, `rls-policies`) was green on that exact head. Still not verified by any hosted run: the refusal itself (an estimate marked sent through the app or a direct call), `EST-` numbering of a newly created estimate on hosted data, and Vercel Production for this merge.

## Issuer branding in estimate exports (branch `feat/estimate-issuer-branding`)

**No migration is needed and no owner SQL pack changes.** The Admin → Companies "Issuer details" screen already holds every field (legal name, TRN, a multi-line address, phone, email, website, logo), and the frozen snapshot already froze all of them, with the logo pinned by path and SHA-256 (`crm_quote_build_content`, applied migration `20261220000100`). Deploy the app only. What changed:

* **Header (PDF page one):** the profile logo on the left; legal name, the address lines as stored and `TRN: <value>` (omitted when empty) right-aligned on the right, with the estimate title, reference, revision and dates under that block. A profile with no logo prints no logo (the bundled ENGINIOUS logo is not used for estimates).
* **Footer (every PDF page):** a thin rule, then the estimate reference on the left, one centred line `Sales enquiries: <phone> · <email> · <website>` and `Page x of y` at the far right. "Sales enquiries:" is a fixed label in code; a missing part and its separator are omitted, and the whole line is omitted when all three are missing. The website is a real link to the stored value normalised to an absolute https URL (`www.example.ae` and `https://www.example.ae` both link to `https://www.example.ae`). Any other scheme (javascript:, data:, file:, ftp: and so on), a `//host` value, spaces or credentials are printed as plain text and never linked.
* **Excel:** the same header lines at the top and the same sales line as the last visible row of the sheet (label, phone and email in one cell, the website beside it as a real hyperlink cell; one plain cell when the website is not linkable), and the same line in the print footer (centre; a print footer cannot hold a link; the reference is dropped before the sales line if the 255-character footer limit would be exceeded).
* **How old documents stay as they were:** the format marker. Estimates now carry `estimate-format:2` (set by the server when a draft is saved, sent for approval or finalised). A snapshot marked `estimate-format:1` (finalised by the Estimates-only release) and a snapshot with no marker (a quotation issued earlier) render exactly as before: the old header with the contact line, no sales footer line, no link, and no value is ever read from the live company profile for a finalised revision. Tests: `export/legacy-regression.test.tsx` (pre-change legacy fixture) and `export/issuer-branding.test.tsx` with the new pre-change fixture `export/__fixtures__/estimate-frozen-v1.json` (PDF text, page count, Excel cells, print footer, file names identical). A draft that carries the `estimate-format:1` marker is moved to `2` when it is next saved, sent for approval or finalised; if it was already approved, the approval is bound to the old version and has to be requested again (the same rule as any edit).
* **Freeze:** nothing new is stored. A finalised revision reads the issuer fields from its own snapshot; editing the company profile afterwards changes nothing in its PDF or Excel, and the next revision picks the new profile up. Drafts show the live profile and stay marked Draft.
* The Admin → Companies button and dialog are now called "Issuer details" (they still said quotation).

Evidence: unit and export tests (header, footer on every page, omissions, multi-line address, link annotation and Excel hyperlink, unsafe schemes, freeze after a profile edit, new revision, legacy and format-1 regressions), and the local-stack browser flow `apps/web/os-shell-checks/quotations-flow.mjs` (Admin → Companies edit, finalise, edit again, re-export unchanged, new revision changed). **Not verified:** any hosted behaviour, Vercel, and logo upload and pinning against real object storage for this change (the local stack has none; the logo path is covered by tests with a storage seam, and earlier hosted-style Storage evidence is in "Local release check" above).

### Issuer details to enter (owner, on hosted V2, after the app is deployed)

**Claude entered nothing on hosted V2, seeded nothing for any entity and added no migration or SQL that writes these values.** Until you enter them, the exports show only what the profile holds (finalising still needs a non-blank legal name, the existing rule). Sign in as a System Administrator, open **Admin → Companies**, find the row **Enginious LLC FZ** (the exact name in the Companies list) and press **Issuer details**. Type exactly:

| Form field | Value |
|---|---|
| Legal name | `Enginious LLC FZ` |
| Tax registration number (TRN) | `100613846300003` |
| Address (a multi-line box; Enter starts a new line, line breaks are kept) | two lines: `Business Center 1, The Meydan Hotel` then `Nad Al Sheba, Dubai 00000, U.A.E.` |
| Phone | `+971 50 7247728` |
| Email | `sales@enginious.ae` |
| Website | `https://www.enginious.ae` |
| Logo | in the same dialog, the second form "Upload logo": choose the official Enginious logo file (PNG, JPEG or WebP, under 900 KB). No logo file is committed with this change. |

Press **Save details**, then upload the logo. A revision finalised afterwards freezes these values; revisions finalised before keep what they were finalised with.

Optional read-only check (a SELECT, no writes; run it in the SQL editor to see what the profile holds):

```sql
select legal_name, trn, address, phone, email, website, logo_path is not null as has_logo
from companies
where legal_name = 'Enginious LLC FZ';
```
