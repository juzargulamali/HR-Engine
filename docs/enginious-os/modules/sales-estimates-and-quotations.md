# Sales: Estimates & Quotations (part 1: builder, issue, frozen snapshot)

Status: in draft PR on branch `feat/estimates-quotations` (not merged, no hosted SQL run). Part 1 only; PDF and Excel export is part 2 (stub at the end). Conventions as in `../README.md`: every claim cites a source; who "can use it" is what the screen offers, the named database function is the real gate and repeats the check. Migration: `supabase/migrations/20261220000100_crm_estimates_quotations.sql`; deployment: `docs/estimates-quotations-deployment.md`.

## 1. Model and decisions

| Topic | What was built | Source |
|---|---|---|
| One record, not two | Every quotation IS a `crm_proposals` row (version, status `draft/sent/superseded/accepted`, `sent_on`, approval link). `crm_quotations` is its 1:1 extension. A proposal row holds only a note and a file, so it cannot hold sections, lines, currency, VAT, bill-to, milestones or terms | migration header; `crm_quote_create` |
| Authorised | The enquiry owner or a Sales founder (`crm_require_owner_or_founder`, the existing proposal rule), company scoped (`crm_has_access`). Other Sales grant holders can read, not change | `crm_quote_load_editable` |
| Status shown | Draft, Draft awaiting approval, Issued, Superseded (derived: `issued_at`, proposal status, a pending approval). "Recorded as sent" / "Accepted" stay the existing manual proposal facts | `lib/crm/quotations/model.ts` `quotationState` |
| Withdraw / cancel | The existing model: "Mark superseded" on Proposals & files (`crm_set_proposal_status`). The snapshot is never altered | proposal status model |
| Approval | Existing commercial approval. Policy `required`: an approval for this proposal, `approved` AFTER the last edit, must exist or issuing is refused. `not_required` and `not_configured` do not gate issuing (they never gated proposals). Request = `crm_request_approval`; decide = `crm_decide_approval` (founder) on the Commercial tab | `crm_quote_issue` |
| Calculation | One function, exact decimals: line = round-half-up(qty x unit price) to 2 decimals; VAT per line = round-half-up(line x rate / 100); subtotals and totals are sums of rounded lines; Out of scope and "not chosen" add no VAT; negative refused. TypeScript and SQL are proved identical by an RLS test | `packages/domain/src/quotations.ts` `calculateQuotation`; `crm_quote_build_content` |
| Currency and VAT | One currency per quotation from AED, SAR, PLN, EUR, USD, chosen explicitly. VAT chosen explicitly from the company's list (seeded Out of scope, 0%, 5%, 15%, 23%; none is a default); a per-item override is allowed. Both are required at issue, optional on a draft. Nothing is inferred from a country | `crm_quote_save_header`, `crm_quote_vat_choices` |
| Internal notes | Only `crm_quotations.internal_notes`. Never copied to the snapshot and never to be read by an export. No costing, supplier price or margin exists in v1 | `crm_quote_build_content` (does not select it); RLS test |
| Bill-to | Chosen explicitly per quotation: an organisation of the enquiry (agency or end client) or any other organisation. Name, place (the only address field organisations have), country, VAT / TRN and trade licence are read live while draft and frozen at issue | `crm_quote_build_content` |
| Issuer | Read from the company's own record (`companies`): legal name, TRN, address, phone, email, website, logo path. At issue the legal name must be non-blank; the TRN is shown when present; nothing else is required | `crm_quote_issue` |
| Revisions | "Create revision" copies an issued quotation to a new draft (same reference, revision + 1, linked). Issuing it marks earlier draft or sent revisions `superseded` (an `accepted` one is left alone); the old snapshot is untouched | `crm_quote_create_revision` |
| Reference | `QUO-<company reference code>-<year>-<nnnn>` from `crm_quote_counters` (same pattern as the enquiry counter), assigned when the draft is created | `crm_quote_create` |

## 2. Control reference

### 2.1 Enquiry page, tab "Estimates & Quotations" (`apps/web/src/app/(app)/sales/opportunities/[id]/quotations-panel.tsx`)

| Control | What it does | Who | Success / failure | Behind it | Tests |
|---|---|---|---|---|---|
| Tab "Estimates & Quotations" | Lists this enquiry's estimates: reference, revision, state, issue or update date, frozen total | Any Sales grant for the company reads | Failed read: "Could not load the estimates" with Try again, never an empty list | `loadQuotationList` | `model.test.ts`; browser flow |
| Link on a row | Opens the estimate | same | | route `/sales/opportunities/[id]/quotations/[proposalId]` | browser flow |
| Create draft estimate | New draft (reference, standard terms copied, nothing else filled) and opens the editor | Owner or founder, enquiry not Won/Lost | Refusal shown in the form: not owner/founder, closed enquiry, "Sales settings are not set up" | `createQuotation` -> `crm_quote_create` | `quotations.test.ts`; RLS "creates a draft", "only the owner or a founder" |

### 2.2 Estimate page (`.../quotations/[proposalId]/page.tsx`, `editor.tsx`)

| Control / block | What it does | Who | Success / failure | Behind it | Tests |
|---|---|---|---|---|---|
| Status badge, banner | "Draft" with "can be edited and saved incomplete"; or "Issued ... frozen and read-only" | all readers | Failed load: "Could not load this estimate" | `quotationState` | browser flow |
| Issued by | Issuer name, TRN, address, contacts from the company profile; not editable here | read only | TRN absent: "No TRN recorded" | `companies` | RLS "issuer details from the company's own record" |
| Bill to | Select: enquiry parties first ("On this enquiry"), then any other organisation. Panel under it shows the account's place, country, VAT / TRN, trade licence (or "No ... recorded"), live | Owner or founder edits | Saving with identifiers missing works (only said) | `saveQuotationDetails` -> `crm_quote_save_header` | RLS "bill-to ... direct and agency-billed"; browser flow |
| Currency | AED, SAR, PLN, EUR, USD, or "Not chosen yet" | same | Other codes refused before and in the database | same | `quotations.test.ts`; RLS |
| VAT | The company's active choices or "Not chosen yet" | same | Required at issue | same | RLS |
| Valid until | Optional date | same | A past date blocks issue | same | `model.test.ts` |
| Internal notes | Team-only text, labelled "never printed, never exported" | same | | same | RLS "never puts internal notes in the snapshot" |
| Save details | Saves the four above and the notes | same | Refusal in words | `saveQuotationDetails` | `quotations.test.ts` |
| Add section | New section at the end | same | Name required, 120 characters | `saveQuotationSection` -> `crm_quote_save_section` | browser flow |
| Section rename (pencil), delete (bin, asks first), move up / down | Rename, remove with its items, reorder. Totals and item numbers follow | same | Reorder of a stale list: "The list changed. Reload and try again" | `saveQuotationSection`, `deleteQuotationSection`, `reorderQuotation` -> `crm_quote_reorder` | RLS "reordering never changes a total"; browser flow |
| Add item / edit (pencil) | Dialog: description, unit, quantity, unit selling price, VAT for this item. The number is automatic | same | Quantity above zero (3 decimals), price zero or more (4 decimals), no negatives; refusals keep the typed text | `saveQuotationLine` -> `crm_quote_save_line` | `quotations.test.ts`; RLS "rejects negative or malformed" |
| Item delete, move up / down | Remove an item (asks first); reorder inside the section | same | | `deleteQuotationLine`, `reorderQuotation` | browser flow |
| Add picture / Remove picture | Picture beside the item: upload through the existing CRM flow (quarantine bucket, server checks of type and real bytes), then attach. JPEG, PNG or WebP, up to 5 MB; the table stores a file reference only | same | Wrong type or size refused in the browser, the server action and `crm_quote_save_line`; a picture of another enquiry is refused | `LinePicture`, `prepareCrmUpload`, `finalizeCrmUpload` (now also returns `fileId`), `setQuotationLineImage` | `validateQuotationImageMeta` in `quotations.test.ts` (domain); RLS "pictures". The local stack has no object storage, so the upload itself was not driven in the browser |
| Totals card | Total excl. VAT, VAT, total incl. VAT, computed live with the shared function | all readers | | `calculate` | `model.test.ts`; domain tests |
| Payment milestones | Rows: label, percent or amount, due text | Owner or founder | Mixed kinds refused; at issue percentages must add to 100 or amounts to the total incl. VAT | `saveQuotationTerms` | domain `validateMilestones`; RLS "milestones must be consistent" |
| Terms | The company template copied at creation, shown as "Standard terms (working draft, pending legal review)"; clauses editable, addable, reorderable per estimate | same | Title and text required | `saveQuotationTerms` | `quotations.test.ts` |
| Issue panel: list of what blocks issue | Currency, VAT, bill-to, an item, no empty section, validity, milestones, approval | all readers | | `issueBlockers` | `model.test.ts` |
| Request founder approval | The existing commercial approval request tied to this estimate | Owner or founder, policy `required` | Refusals of `crm_request_approval` shown ("not configured", "already waiting") | `requestQuotationApproval` -> `crm_request_approval` | RLS "approval"; browser flow |
| Issue quotation (asks first) | Freezes the snapshot; the page becomes read-only; nothing is sent to anyone | Owner or founder | Refusal in words (VAT missing, approval missing, issuer name missing ...) | `issueQuotation` -> `crm_quote_issue` | `quotations.test.ts`; RLS "draft, calculation and issue rules", "approval", "freeze"; browser flow |
| Issued quotation view | Read-only rendering of the frozen snapshot (issuer, bill-to with identifiers, sections, totals, milestones, terms) | all readers | | `SnapshotView` | browser flow |
| Create revision | New draft copy, revision + 1, opens it | Owner or founder, enquiry open, no unissued revision | "There is already an unissued revision" | `createQuotationRevision` -> `crm_quote_create_revision` | RLS "a revision is a new draft"; browser flow |
| Revisions list | Links to every revision of the reference | all readers | | `loadQuotation` | browser flow |

### 2.3 Sales settings (`apps/web/src/app/(app)/sales/settings/`)

| Control | What it does | Who | Success / failure | Behind it | Tests |
|---|---|---|---|---|---|
| VAT choices: Add VAT choice | Adds a rate to the company's list (Out of scope and 0% exist already) | Founder or `manage_settings` | Refusal "Not allowed to change Sales settings" | `saveVatChoice` -> `crm_save_vat_choice` | RLS "settings ... need the manage_settings capability" |
| Standard terms: edit, add, remove, reorder clauses, Save standard terms | Changes the company template for NEW estimates only; read-only list for others | same | At least one clause | `saveTermsTemplate` -> `crm_save_terms_template` | `quotations.test.ts`; RLS "freeze" (template edit changes nothing issued) |

### 2.4 Admin, Companies (`apps/web/src/app/(app)/admin/companies/`)

| Control | What it does | Who | Success / failure | Behind it | Tests |
|---|---|---|---|---|---|
| Quotation details: Save details | Legal name, TRN, address, phone, email, website of the issuer | System Administrator (existing `companies_write`) | Others: "Only a System Administrator can change company details" | `updateCompanyIssuerDetails` | RLS "issuer fields ... System Administrator writes only" |
| Upload logo / Replace logo | PNG, JPEG or WebP under 900 KB, bytes checked, stored privately under a new path | System Administrator | Refusals in words | `uploadCompanyLogo` -> `crm_set_company_logo` | RLS "company logo is set by a System Administrator only" |

### 2.5 Frozen snapshot (the seam for part 2)

`crm_quotation_snapshots.content` (type `QuotationSnapshot`, `packages/domain/src/quotations.ts`): `schema_version`, `reference`, `revision`, `issue_date`, `validity_date`, `enquiry`, `issuer` (incl. `logo_path` in bucket `company-logos`), `bill_to`, `currency`, `minor_units`, `vat`, `sections[].lines[]` (number, description, `image` reference in bucket `crm-files`, unit, quantity, unit price, per-line VAT, net, VAT, gross), subtotals, `totals`, `milestones` (with computed amounts), `terms`. Guard triggers refuse any change, even by a table owner (`crm_quotation_frozen`). Read it through `loadQuotation(...).snapshot` (`apps/web/src/lib/crm/quotations/data.ts`).

## 3. Not covered in part 1 (stated, not hidden)

No PDF or Excel (part 2). No costing, supplier price, margin or discount. No sending of a quotation. Moving an item to another section: delete and re-add (reorder works inside a section). Hiding or editing an existing VAT choice has a database function but no screen (only Add). The line picture upload cannot be driven on the local stack (no object storage); its checks are covered by unit and RLS tests. "Record as sent" on Proposals & files is not blocked for a draft estimate (the existing rule is unchanged).

## Export (part 2)

Reserved for part 2: PDF and XLSX rendered from the frozen snapshot above.
