# Sales & CRM action catalogue

Status: built from the code at `main` `d4a9dc325dc669990e146ebb15eeb0cc3d2c11d4` (`../README.md` stamp row "Sales & CRM app map completed"). **Code read only; nothing was run** (no app, database or hosted project), **except** the three entries changed on 2026-11-08 by the write-rules fixes (`sales.zoho.save_references`, `sales.proposal.supersede`, `sales.enquiry.mark_won`: migration `20261222000100`, **applied on hosted V2 per the owner (owner-run verification, owner-reported 2026-11-09)**, guide `../../sales-crm-write-rules-deployment.md`; exercised on a throwaway local database and the local-stack walk-through). This is a lookup table of every Sales & CRM action that changes data, advances a workflow or communicates outside the system, so a person or an AI worker can decide what an action does before anyone does it. The per-screen references are linked from each entry's "Reached through" line; the screen-by-screen index is [`sales-coverage-index.md`](./sales-coverage-index.md). Conventions as in `../README.md`: every claim cites a source; `Unverified` marks what code reading could not confirm.

## 0. What this catalogue is NOT (read first)

* **Availability as a UI action does not make something an approved tool for an AI worker.** A button or form existing in the app only means a person can press it. Whether a worker may take the action, on which record, for whom, is decided by the people who own the process; this catalogue records what the action does and what it needs, not that it is allowed to be automated.
* **A documented database function is NOT automatically an approved tool.** Every function named here is `SECURITY DEFINER` and is reached through an app server action with the signed-in person's own session. Nothing in this file authorises calling a function directly, from SQL, or with a service key.
* **Internal helper functions** (definer helpers, triggers, guards, cron and service-role functions) are listed separately in section 6 ("Internal functions (not tools)"). **No worker should call them directly.**
* Hosted data: this map describes the code. It says nothing about hosted records, and a worker must not use hosted data or hosted accounts for any action here without the owner's explicit instruction (`CLAUDE.md` boundaries).

## 1. Worker rules

1. **Read before write.** Open the record (enquiry page, account page, estimate page) and note its stage, status and `version` before any action.
2. **One action at a time**, then verify (the "Verify" field) before the next.
3. **Never act on a record in a state not listed under "Starting states".** If the state is not listed, stop.
4. **Stop and ask** when the STOP flag says so, when a required input is not given to you by a person, or when anything is ambiguous (two similar organisations, two enquiries that may be duplicates, a date you had to guess).
5. **Never retry a non-idempotent action without first reading the state.** After an ambiguous failure (timeout, "could not save", page error), read the record; act again only if the change is not there. "Duplicate risk" actions create another row every time.
6. **Never call internal functions** (section 6) or any `crm_*`, `proj_*` function directly.
7. **Never use hosted data** (Production or V2) unless the owner has said so for that task; never create test data in Production.
8. **Report what changed and how it was verified**: record id or reference, the field or row, the screen or read you used, the result.
9. Do not let a read-only export (section 5) leave the people who are allowed to see it; exports contain names, contacts and values.

## 2. How to read an entry

Fields: (1) action name, server action and where it is reached; (2) record and how it is identified; (3) required inputs; (4) permissions and who is refused; (5) starting states and what refuses otherwise; (6) what changes; (7) side effects; (8) how to verify; (9) STOP flag and who approves; (10) retry safety; (11) surface (**UI** = button or form that calls a server action which calls the database function; **Both** = also reachable as the same internal function; every entry here is "UI action over a DB function" unless stated).

Shared meanings:
* **Version check**: the app compares `expectedVersion` with `crm_opportunities.version` (`staleMessage`, `apps/web/src/lib/actions/crm.ts`) and the function repeats it (`crm_check_version`, errcode 40001). A write that carries a version cannot silently overwrite someone else's change.
* **Owner/founder** = the enquiry's `owner_id`, or a Sales founder of that company (`crm_require_owner_or_founder`; `canEditOpportunity`).
* **Verify (enquiry)** = open `/sales/opportunities/<id>`, tab Activity & history: the timeline shows the event named under "Side effects" (`crm_opportunity_events`), and the field shows its new value; the `version` increases by one where a version is bumped.
* All actions need the person to be signed in with an active Sales grant for the record's company (`crm_has_access`); otherwise the function answers "not found" and nothing is revealed.

## 3. Actions by area

### 3.1 Enquiries, contacts and files (references: [enquiries](./sales-enquiries.md))

#### `sales.enquiry.create`
| Field | Entry |
|---|---|
| (1) Reached | `createOpportunity` (`apps/web/src/lib/actions/crm.ts`) from Quick add and `/sales/new`; function `crm_create_opportunity` (`20261115000200_crm_workflow_functions.sql`) |
| (2) Record | New `crm_opportunities` row; identified afterwards by the returned id and the reference `OPP-<code>-<year>-<nnnn>` |
| (3) Inputs | Company, title (1 to 200), source (one of 8, [enquiries 3.3](./sales-enquiries.md#33-dropdown-options-and-where-they-come-from)), agency or end client (at least one, role-aware), next action title and date (time default 10:00 Dubai, type), optional owner, dates, location, technologies (name and whole quantity at least 1), value (zero or more), currency (3 letters), brief, scope, waiting on, contacts |
| (4) Permissions | Any Sales grant for the company; another owner needs `assign_owner` and that person needs an active grant; refused: no grant, no settings row ("CRM settings ... not configured"), agency or client lacking the role (trigger `crm_opportunities_party_roles`), invalid technologies |
| (5) Starting states | None (creates). Company must have a `crm_company_settings` row |
| (6) Changes | `crm_opportunities` (stage `new`), `crm_reference_counters`, `crm_opportunity_contacts`, one open `crm_follow_ups` row for the owner |
| (7) Side effects | Event `created`; optional `crm_outreach_link_inquiry` when started from Outreach (its refusal leaves the enquiry in place); the new next action appears in the owner's Follow-ups and can later raise reminders |
| (8) Verify | `/sales/opportunities?open=<id>` or the page: reference, stage New enquiry, owner, one open follow-up, timeline "Enquiry created." |
| (9) STOP | No. Ask if a similar enquiry warning appears ("This may be the same enquiry"): the person decides |
| (10) Retry | **Duplicate risk**: each call makes another enquiry and consumes a reference number; no idempotency key. (The JARVIS door, 3.9, is idempotent per confirmation id.) After an ambiguous failure search the list for the title and organisation first |
| (11) Surface | UI over DB function |

#### `sales.enquiry.edit_details`
| Field | Entry |
|---|---|
| (1) Reached | `updateOpportunity` (`crm.ts`); `crm_update_opportunity`; Edit details / Edit value dialog |
| (2) Record | `crm_opportunities` row by id and `expectedVersion` |
| (3) Inputs | Any of: title, brief, agency, end client, currency, value, budget note, payment terms, dates, location, technologies, scope, exclusions, risks, waiting on. Missing = unchanged, empty = cleared. Value zero or more |
| (4) Permissions | Owner/founder. Value or currency of a Won enquiry: Sales founder only. Refused: others; Lost enquiries |
| (5) Starting states | Open stages (any, including On hold) and Won (money only, founder). Lost refused ("can no longer be edited") |
| (6) Changes | The listed columns; `version + 1`; an equipment check shows "needs repeating" if dates or technologies changed |
| (7) Side effects | Events `value_changed` (from, to) and `details_changed` (field names) |
| (8) Verify | Timeline lines "Value changed ..." / "Details changed: ..."; the fields on Overview and Scope & dates |
| (9) STOP | **Conditional yes**: changing the value or currency of a Won enquiry (affects reports and handover), or changing agency or end client (affects account counts). Approver: a Sales founder / the enquiry owner |
| (10) Retry | Safe through the version check: a repeat with the old version is refused as stale. Read first; a call without a version would not be guarded (the UI always sends one) |
| (11) Surface | UI over DB function |

#### `sales.enquiry.assign_owner`
| Field | Entry |
|---|---|
| (1) Reached | `assignOwner` (`crm.ts`); `crm_assign_owner` |
| (2) Record | `crm_opportunities` by id |
| (3) Inputs | New owner (an active Sales grant holder of the company); reason (optional) |
| (4) Permissions | `assign_owner` capability (founder implies it). Refused: others, a new owner without a grant for the company |
| (5) Starting states | Open stages including On hold. Won and Lost refused ("A closed opportunity cannot be reassigned") |
| (6) Changes | `owner_id`, `version + 1`; the previous owner's **open follow-ups move to the new owner** (`assigned_to`) |
| (7) Side effects | Event `owner_changed` (with reason); no e-mail |
| (8) Verify | Header Owner; timeline "Owner changed from X to Y"; Follow-ups shows the moved rows under the new owner |
| (9) STOP | **Yes**: hands responsibility to another person and moves several follow-ups. Approver: a founder or the `assign_owner` holder who asked |
| (10) Retry | Idempotent: assigning the current owner returns without change |
| (11) Surface | UI over DB function |

#### `sales.enquiry.add_activity`
| Field | Entry |
|---|---|
| (1) Reached | `addActivity` (`crm.ts`); `crm_add_activity` (+ `crm_complete_follow_up` and/or `crm_create_follow_up`) |
| (2) Record | Timeline of one enquiry (`crm_activities`) |
| (3) Inputs | Kind (note, call, email, meeting, client_response), text (required), internal tick; optional follow-up to complete; optional next step (title, date, type) |
| (4) Permissions | **Any Sales grant** of the company (not only the owner); completing a follow-up needs the follow-up actor rule |
| (5) Starting states | Not Lost ("A lost opportunity can no longer be updated"); an activity cannot be dated in the future (the app dates it now) |
| (6) Changes | New `crm_activities` row; first call, email or meeting sets `first_response_at`; optional follow-up done and/or a new follow-up |
| (7) Side effects | Completing writes an internal note "Follow-up done: ..."; a refused second step is reported as a partial result (the first part stays) |
| (8) Verify | Timeline shows the activity; Follow-ups shows the next step |
| (9) STOP | No |
| (10) Retry | **Duplicate risk** (another timeline row each time); partial success possible: read the timeline and follow-ups first |
| (11) Surface | UI over DB function |

#### `sales.enquiry.contact_link`
| Field | Entry |
|---|---|
| (1) Reached | `linkContact` (`crm.ts`); `crm_link_contact` (Add to this opportunity; Change role) |
| (2) Record | `crm_opportunity_contacts` (opportunity id + contact id) |
| (3) Inputs | Contact id, optional role on this enquiry |
| (4) Permissions | Owner/founder |
| (5) Starting states | Not Lost; contact not archived |
| (6) Changes | Link row (role updated if already linked) |
| (7) Side effects | Event `contact` ("Contact linked" or "Contact role updated") |
| (8) Verify | Overview > Contacts lists the person with the role |
| (9) STOP | No |
| (10) Retry | Idempotent (upsert on opportunity + contact); repeats the timeline event |
| (11) Surface | UI over DB function |

#### `sales.enquiry.contact_unlink`
| Field | Entry |
|---|---|
| (1) Reached | `unlinkContact` (`crm.ts`); `crm_unlink_contact` |
| (2) Record | `crm_opportunity_contacts` row |
| (3) Inputs | Opportunity id, contact id |
| (4) Permissions | Owner/founder |
| (5) Starting states | Not Lost |
| (6) Changes | Deletes the link only (the contact stays) |
| (7) Side effects | Event `contact` "Contact unlinked" only if a link was deleted |
| (8) Verify | The person no longer appears under Contacts |
| (9) STOP | No |
| (10) Retry | Idempotent |
| (11) Surface | UI over DB function |

#### `sales.enquiry.contact_create_and_link`
| Field | Entry |
|---|---|
| (1) Reached | `createAndLinkContact` (`crm.ts`); `crm_create_contact` then `crm_link_contact` |
| (2) Record | New `crm_contacts` row, then a link |
| (3) Inputs | Name (required, max 200), organisation (optional), job title, valid email, phone, role on this enquiry |
| (4) Permissions | Create: any Sales grant; link: owner/founder (so a non-owner is refused at the link step and **the contact still exists**) |
| (5) Starting states | Enquiry not Lost |
| (6) Changes | New shared contact; link row |
| (7) Side effects | Event `contact` |
| (8) Verify | Contact under Contacts; the organisation's contact list |
| (9) STOP | No (but check the person is not already recorded) |
| (10) Retry | **Duplicate risk**: creates another contact each call; search the organisation's contacts first |
| (11) Surface | UI over two DB functions |

#### `sales.contact.create`
| Field | Entry |
|---|---|
| (1) Reached | `createContact` (`crm.ts`); `crm_create_contact`; account page, `/sales/clients`, new-enquiry dialog |
| (2) Record | New `crm_contacts` row |
| (3) Inputs | Name (required), organisation (optional), job title, email (validated), phone |
| (4) Permissions | Any Sales grant (`crm_has_any_access`) |
| (5) Starting states | None |
| (6) Changes | `crm_contacts` row (`created_by` = the person) |
| (7) Side effects | Audit trigger only |
| (8) Verify | Account page Contacts, `/sales/clients` |
| (9) STOP | No |
| (10) Retry | **Duplicate risk** |
| (11) Surface | UI over DB function |

#### `sales.contact.update_shared`
| Field | Entry |
|---|---|
| (1) Reached | `updateContact` (`crm.ts`); `crm_update_contact`; "Save for everyone" |
| (2) Record | `crm_contacts` row by id (shared by every enquiry the person is on) |
| (3) Inputs | Name, job title, email, phone (and organisation) |
| (4) Permissions | The contact's creator, any Sales founder, or the owner of a not-lost enquiry it is on (`crm_can_edit_contact`) |
| (5) Starting states | Contact not archived |
| (6) Changes | The named columns |
| (7) Side effects | One timeline line on **every** linked enquiry the editor can see ("Contact details updated (...)") |
| (8) Verify | Contact details on any linked enquiry; timeline lines |
| (9) STOP | **Yes**: changes a shared record seen on several enquiries. Approver: the contact's owner/creator or a founder |
| (10) Retry | Idempotent for equal values; repeats the timeline lines on every enquiry each time |
| (11) Surface | UI over DB function |

#### `sales.organisation.create_simple`
| Field | Entry |
|---|---|
| (1) Reached | `createOrganisation` (`crm.ts`); `crm_create_organisation` (replaced in `20261219000100_crm_clients_agencies.sql` so it also records the role); `/sales/clients`, new-enquiry and edit pickers ("Add organisation") |
| (2) Record | New `crm_organisations` row (shared reference data) |
| (3) Inputs | Name (1 to 200), type Agency / End client / Direct client, place, note |
| (4) Permissions | Any Sales grant |
| (5) Starting states | None; a similar-name hint (`crm_find_similar_organisations`) never blocks |
| (6) Changes | `crm_organisations` (`kind`, roles derived by trigger `crm_organisations_sync_kind`, `created_by`) |
| (7) Side effects | Audit trigger |
| (8) Verify | `/sales/clients` or the Clients & Agencies directory shows it |
| (9) STOP | No; ask if the hint shows a similar name |
| (10) Retry | **Duplicate risk**: `name_key` is indexed, not unique; a second call creates a second organisation |
| (11) Surface | UI over DB function |

#### `sales.enquiry.add_link`
| Field | Entry |
|---|---|
| (1) Reached | `addLink` (`crm.ts`); `crm_register_file` (kind `link`) |
| (2) Record | New `crm_files` row on one enquiry |
| (3) Inputs | https address (must contain a dot, no spaces), purpose (proposal, purchase_order, authorised_email, brief, other), label |
| (4) Permissions | Any Sales grant for the company |
| (5) Starting states | Not Lost (`crm_register_file`: `Unverified` exact refusal text; the proposal and upload functions refuse Lost) |
| (6) Changes | `crm_files` row |
| (7) Side effects | Event `file` |
| (8) Verify | Files list on Proposals & files; timeline "File or link recorded" |
| (9) STOP | No. The app never opens or checks the link: do not add a link whose sharing settings you cannot vouch for |
| (10) Retry | **Duplicate risk** |
| (11) Surface | UI over DB function |

#### `sales.enquiry.upload_file`
| Field | Entry |
|---|---|
| (1) Reached | `prepareCrmUpload` then `finalizeCrmUpload` (`apps/web/src/lib/actions/crmFiles.ts`); `crm_create_upload_intent`, `crm_get_upload_intent`, `crm_register_uploaded_file` (plus service-role `crm_mark_upload_intent`) |
| (2) Record | `crm_upload_intents` row, then `crm_files` row |
| (3) Inputs | File (PDF, JPEG, PNG, WebP, docx, xlsx, pptx, text, CSV; up to 20 MB; executables and macros refused), purpose, label |
| (4) Permissions | Any Sales grant for the company; the intent belongs to the uploader |
| (5) Starting states | Enquiry not Lost; intent must be `validated` ("This upload was already added" on repeat) |
| (6) Changes | Quarantine object, then final object in the private bucket, `crm_files` row |
| (7) Side effects | Event `file`; any rejection removes the stored object; service-role storage writes inside the app |
| (8) Verify | File in the Files list; "Open" returns it |
| (9) STOP | No (do not upload personal data beyond what the process needs) |
| (10) Retry | **Registration is idempotent per intent** (repeat refused "already added"); a new upload is a new intent and a duplicate file. If it failed, read the Files list first |
| (11) Surface | UI over DB functions; not catalogued as a worker tool without browser upload |

#### `sales.enquiry.remove_file`
| Field | Entry |
|---|---|
| (1) Reached | `removeCrmFile` (`crmFiles.ts`); `crm_remove_file` |
| (2) Record | `crm_files` row (soft-deleted) and its storage object |
| (3) Inputs | File id |
| (4) Permissions | The uploader, the enquiry owner or a founder |
| (5) Starting states | File not already removed ("File not found"); a picture used on an issued estimate cannot be removed |
| (6) Changes | `deleted_at`; any proposal pointing at it loses `file_id`; **the stored object is deleted** |
| (7) Side effects | Storage deletion by the service role |
| (8) Verify | File gone from the list; proposal shows "No document linked" |
| (9) STOP | **Yes**: irreversible (the file is deleted from storage). Approver: the enquiry owner or a founder |
| (10) Retry | Second call refused ("File not found") |
| (11) Surface | UI over DB function |

### 3.2 Stage changes (references: [pipeline and stages](./sales-pipeline-and-stages.md), [close and handover](./sales-close-and-handover.md))

#### `sales.enquiry.move_stage`
| Field | Entry |
|---|---|
| (1) Reached | `moveStage` (`crm.ts`); `crm_move_stage`; Move stage dialog, panel menu, board drag |
| (2) Record | `crm_opportunities` by id and version |
| (3) Inputs | Target working stage (one step back or any forward) |
| (4) Permissions | Owner/founder |
| (5) Starting states | A working stage only. Refused: On hold ("Resume first"), Won/Lost, same stage, more than one step back, to On hold/Won/Lost. Proposal sent needs a proposal `sent` or `accepted`; Quote sent needs a non-blank Zoho quote reference |
| (6) Changes | `stage`, `stage_changed_at`, `version + 1` |
| (7) Side effects | Event `stage_changed` (from, to) |
| (8) Verify | Stage badge; timeline "Stage changed from X to Y." |
| (9) STOP | **Conditional yes**: moving to Proposal sent or Quote sent marks a workflow step as sent. Approver: the enquiry owner |
| (10) Retry | Safe: the same move from the new stage is refused (same stage / stale version) |
| (11) Surface | UI over DB function |

#### `sales.enquiry.hold`
| Field | Entry |
|---|---|
| (1) Reached | `holdOpportunity` (`crm.ts`); `crm_hold_opportunity` |
| (2) Record | `crm_opportunities` |
| (3) Inputs | Reason (list or Other + note), review date (today or later, Dubai) |
| (4) Permissions | Owner/founder |
| (5) Starting states | A working stage ("Only an open opportunity can be put on hold") |
| (6) Changes | `stage = on_hold`, `stage_before_hold`, `hold_reason`, `hold_review_date`, `version + 1` |
| (7) Side effects | Event `held`; a hold-review reminder is created when the date arrives |
| (8) Verify | On hold notice with reason and date |
| (9) STOP | No |
| (10) Retry | Safe: a second hold is refused (already on hold) |
| (11) Surface | UI over DB function |

#### `sales.enquiry.resume`
| Field | Entry |
|---|---|
| (1) Reached | `resumeOpportunity` (`crm.ts`); `crm_resume_opportunity` |
| (2) Record | `crm_opportunities` |
| (3) Inputs | Next action title, date, time, type |
| (4) Permissions | Owner/founder |
| (5) Starting states | On hold only |
| (6) Changes | Stage back to `stage_before_hold`; hold fields cleared; a new open follow-up for the owner; `version + 1` |
| (7) Side effects | Event `resumed` |
| (8) Verify | Stage badge; a new follow-up |
| (9) STOP | No |
| (10) Retry | Safe: second call refused ("not on hold") |
| (11) Surface | UI over DB function |

#### `sales.enquiry.mark_won`
| Field | Entry |
|---|---|
| (1) Reached | `markWon` (`crm.ts`); `crm_mark_won`; Close page and dialogs |
| (2) Record | `crm_opportunities` |
| (3) Inputs | Evidence type (purchase order or authorised email), reference, document date (**not after the Dubai day**: the form's `max` and, since migration `20261222000100` (applied on hosted V2 per the owner (owner-run verification, owner-reported 2026-11-09)), `crm_mark_won` itself, SQLSTATE `22023`; a refused call changes nothing), optional note; the enquiry must have a value |
| (4) Permissions | Owner/founder |
| (5) Starting states | A working stage (not On hold) |
| (6) Changes | Stage `won`, evidence columns, `closed_at`, `closed_by`, `stage_before_close`; new `crm_closures` row; **all open follow-ups cancelled**; an empty `crm_handovers` row (kept if one exists) |
| (7) Side effects | Event `won`; the enquiry becomes read-only except the handover, files, proposal acceptance, contacts and founder value edits; the Won handover prompt, My Day "Won, handover not submitted" |
| (8) Verify | Won notice with evidence; timeline "Marked Won ..."; follow-ups all cancelled; handover prompt |
| (9) STOP | **Yes**: marks the sale won (reports, handover, client record). Approver: the enquiry owner or a founder, with the actual PO or authorised email in hand |
| (10) Retry | Safe: a second call is refused (not open) |
| (11) Surface | UI over DB function |

#### `sales.enquiry.mark_lost`
| Field | Entry |
|---|---|
| (1) Reached | `markLost` (`crm.ts`); `crm_mark_lost` |
| (2) Record | `crm_opportunities` |
| (3) Inputs | Reason (list or Other + text) |
| (4) Permissions | Owner/founder |
| (5) Starting states | Any open stage including On hold |
| (6) Changes | Stage `lost`, `lost_reason`, `stage_before_close`, hold fields cleared, `closed_at`, `closed_by`; new `crm_closures` row; open follow-ups cancelled |
| (7) Side effects | Event `lost`; the enquiry becomes read-only until reopened |
| (8) Verify | Lost notice with reason; timeline "Marked Lost." |
| (9) STOP | **Yes**: closes the enquiry and cancels follow-ups. Approver: the enquiry owner or a founder |
| (10) Retry | Safe: second call refused ("already closed") |
| (11) Surface | UI over DB function |

#### `sales.enquiry.reopen`
| Field | Entry |
|---|---|
| (1) Reached | `reopenOpportunity` (`crm.ts`); `crm_reopen_opportunity` |
| (2) Record | `crm_opportunities`, `crm_closures` |
| (3) Inputs | Reason (required), target working stage (default: where it was closed from, else Negotiation), a new next action (title, date, type) |
| (4) Permissions | `reopen_closed` capability (founder implies); **not the owner as such** |
| (5) Starting states | Won or Lost only |
| (6) Changes | Stage to the target; evidence and lost reason cleared from the live row (kept in `crm_closures`, marked reopened with who and why); owner replaced by the reopener if the old owner lost access; new open follow-up; `version + 1` |
| (7) Side effects | Events `reopened` (and `owner_changed`); a prepared handover is left exactly as it was and flagged |
| (8) Verify | Stage badge; Closure history shows "Was won/lost" with the reason; a new follow-up |
| (9) STOP | **Yes**: reverses a closed outcome; affects reports and a possible handover. Approver: a founder (or the `reopen_closed` holder) |
| (10) Retry | Safe: second call refused (not closed) |
| (11) Surface | UI over DB function |

### 3.3 Follow-ups and reminders (reference: [follow-ups](./sales-followups.md))

#### `sales.followup.create`
| Field | Entry |
|---|---|
| (1) Reached | `createFollowUp` (`crm.ts`); `crm_create_follow_up` |
| (2) Record | New `crm_follow_ups` row on an enquiry |
| (3) Inputs | Enquiry id, title, date, time (Dubai), type, optional assignee |
| (4) Permissions | Any Sales grant; another assignee needs owner or `assign_owner` unless the assignee is the owner; the assignee needs a grant |
| (5) Starting states | Enquiry not Won/Lost |
| (6) Changes | `crm_follow_ups` row (assigned to the chosen person or the creator) |
| (7) Side effects | May later produce due and overdue reminders |
| (8) Verify | Enquiry Overview > Follow-ups; the Follow-ups page |
| (9) STOP | No |
| (10) Retry | **Duplicate risk** |
| (11) Surface | UI over DB function |

#### `sales.followup.complete`
| Field | Entry |
|---|---|
| (1) Reached | `completeFollowUp` (`crm.ts`); `crm_complete_follow_up` |
| (2) Record | `crm_follow_ups` row by id (enquiry or account follow-up) |
| (3) Inputs | Outcome (required); if it is the last open follow-up of an active enquiry: a next follow-up OR a hold reason and review date |
| (4) Permissions | Assignee, enquiry owner, or founder (account follow-up: assignee, creator, founder) |
| (5) Starting states | Follow-up `open` ("already closed" otherwise) |
| (6) Changes | `status done`, `completed_at`, `completed_by`, `outcome`; maybe a new follow-up **assigned to the enquiry owner**; maybe the enquiry goes On hold |
| (7) Side effects | Internal note "Follow-up done: ..." on the timeline; `held` event if put on hold; the reminders of the old row stop |
| (8) Verify | Follow-up leaves To do and shows in Recently completed with the outcome |
| (9) STOP | **Conditional yes**: choosing "put on hold" changes the enquiry's stage. Approver: the enquiry owner |
| (10) Retry | Safe: second call refused ("already closed"); read the next follow-up first |
| (11) Surface | UI over DB function |

#### `sales.followup.reschedule`
| Field | Entry |
|---|---|
| (1) Reached | `rescheduleFollowUp` (`crm.ts`); `crm_reschedule_follow_up` |
| (2) Record | `crm_follow_ups` row |
| (3) Inputs | New date and time (Dubai) |
| (4) Permissions | As complete |
| (5) Starting states | `open` |
| (6) Changes | `due_at`; reminders already generated for it are deleted |
| (7) Side effects | A fresh reminder will be created for the new date |
| (8) Verify | Due text on the row |
| (9) STOP | No |
| (10) Retry | Idempotent |
| (11) Surface | UI over DB function |

#### `sales.followup.cancel`
| Field | Entry |
|---|---|
| (1) Reached | `cancelFollowUp` (`crm.ts`); `crm_cancel_follow_up` |
| (2) Record | `crm_follow_ups` row |
| (3) Inputs | Reason (required) |
| (4) Permissions | As complete |
| (5) Starting states | `open`, and not the only open follow-up of an active enquiry |
| (6) Changes | `status cancelled`, `outcome` = reason |
| (7) Side effects | None |
| (8) Verify | Row leaves To do |
| (9) STOP | No |
| (10) Retry | Safe: second call refused |
| (11) Surface | UI over DB function |

#### `sales.followup.reassign`
| Field | Entry |
|---|---|
| (1) Reached | `reassignFollowUp` (`apps/web/src/lib/actions/clients-agencies.ts`); `crm_reassign_follow_up`; account page only. Reference: [C section 2.2](./sales-clients-and-agencies.md#22-account-page-appswebsrcappappsalesaccountsidpagetsx) |
| (2) Record | `crm_follow_ups` row |
| (3) Inputs | New assignee (a person with a Sales grant for the company) |
| (4) Permissions | The follow-up actor rules; handing to a third person needs the enquiry owner or `assign_owner` (account follow-up: the creator or `assign_owner`) |
| (5) Starting states | `open`; enquiry not Won/Lost |
| (6) Changes | `assigned_to`; reminders for the old assignee deleted |
| (7) Side effects | None; does not change the enquiry or account owner |
| (8) Verify | "Responsible" on the follow-up row |
| (9) STOP | **Conditional yes**: moves work to another person; ask when more than one |
| (10) Retry | Idempotent (same assignee returns without change) |
| (11) Surface | UI over DB function |

#### `sales.followup.create_on_account`
| Field | Entry |
|---|---|
| (1) Reached | `createAccountFollowUp` (`clients-agencies.ts`); `crm_create_account_follow_up`. Reference: [C section 9.3](./sales-clients-and-agencies.md#93-follow-up-on-an-account-with-no-inquiry) |
| (2) Record | New `crm_follow_ups` row on an organisation with no enquiry |
| (3) Inputs | Organisation, company, title, due date and time, type, optional assignee |
| (4) Permissions | Any Sales grant for the company; someone else only with `assign_owner`; the assignee needs a grant |
| (5) Starting states | Account with no open enquiry (the UI offers it there) |
| (6) Changes | `crm_follow_ups` (no `opportunity_id`) |
| (7) Side effects | **No reminders are generated for it** (the reminder function joins enquiries) |
| (8) Verify | Account page Follow-ups; the Follow-ups page row "Account follow-up (no inquiry)" |
| (9) STOP | No |
| (10) Retry | **Duplicate risk** |
| (11) Surface | UI over DB function |

#### `sales.reminder.mark_read`
| Field | Entry |
|---|---|
| (1) Reached | `markRemindersRead` (`crm.ts`); `crm_mark_reminder_read` |
| (2) Record | The person's own `crm_reminders` rows |
| (3) Inputs | One reminder id, or none for all |
| (4) Permissions | Own rows only |
| (5) Starting states | Unread rows |
| (6) Changes | `read_at` |
| (7) Side effects | None |
| (8) Verify | Reminders card count |
| (9) STOP | No |
| (10) Retry | Idempotent |
| (11) Surface | UI over DB function |

### 3.4 Proposals, availability, approval and Zoho references (reference: [proposals and Zoho](./sales-proposals-and-zoho.md))

#### `sales.proposal.add_version`
| Field | Entry |
|---|---|
| (1) Reached | `addProposal` (`crm.ts`); `crm_add_proposal` |
| (2) Record | New `crm_proposals` row on an enquiry (version assigned) |
| (3) Inputs | Note, optional file already on this enquiry |
| (4) Permissions | Owner/founder |
| (5) Starting states | Enquiry not Won/Lost |
| (6) Changes | `crm_proposals` (status `draft`) |
| (7) Side effects | Event `proposal` "vN draft"; nothing is sent |
| (8) Verify | Proposal versions list |
| (9) STOP | No |
| (10) Retry | **Duplicate risk** (the next version number each time) |
| (11) Surface | UI over DB function |

#### `sales.proposal.record_sent`
| Field | Entry |
|---|---|
| (1) Reached | `setProposalStatus` with status `sent` (`crm.ts`); `crm_set_proposal_status` |
| (2) Record | `crm_proposals` row by id |
| (3) Inputs | The date it was actually sent (not in the future) |
| (4) Permissions | Owner/founder |
| (5) Starting states | Proposal `draft` (or already `sent`); open enquiry; **not an estimate** (the app refuses, and trigger `crm_proposals_estimate_sent_guard` refuses with EST01) |
| (6) Changes | `status sent`, `sent_on`; **every other `sent` proposal of the enquiry becomes `superseded`** |
| (7) Side effects | Event `proposal`; it unlocks the Proposal sent stage move; **nothing is sent to the client by the system** |
| (8) Verify | "Sent" badge, "Latest sent", date |
| (9) STOP | **Yes**: records that a proposal went to the client and supersedes the earlier one. Approver: the enquiry owner, with the real send date |
| (10) Retry | Not safely repeatable: a repeat on a sent version re-sets `sent_on` and supersedes others again; read first |
| (11) Surface | UI over DB function |

#### `sales.proposal.record_accepted`
| Field | Entry |
|---|---|
| (1) Reached | `setProposalStatus` with status `accepted`; `crm_set_proposal_status` |
| (2) Record | `crm_proposals` row |
| (3) Inputs | None |
| (4) Permissions | Owner/founder |
| (5) Starting states | Proposal `sent`; allowed on a Won enquiry; not on Lost |
| (6) Changes | `status accepted` |
| (7) Side effects | Event `proposal`; does NOT make the enquiry Won; feeds the handover "accepted proposal" |
| (8) Verify | "Accepted" badge; handover page "Accepted proposal" |
| (9) STOP | **Yes**: records the client's acceptance. Approver: the enquiry owner, from evidence of the client's answer |
| (10) Retry | Safe: second call refused ("Only a sent proposal can be recorded as accepted") |
| (11) Surface | UI over DB function |

#### `sales.proposal.supersede`
| Field | Entry |
|---|---|
| (1) Reached | `setProposalStatus` with status `superseded`; `crm_set_proposal_status` |
| (2) Record | `crm_proposals` row |
| (3) Inputs | None |
| (4) Permissions | Owner/founder |
| (5) Starting states | `draft` or `sent` only: the UI offers it for those, and the database now refuses `accepted` and already `superseded` versions (SQLSTATE `23514`; migration `20261222000100`, **applied on hosted V2 per the owner (owner-run verification, owner-reported 2026-11-09)**; a database without the migration still accepts any starting status). The enquiry must be open |
| (6) Changes | `status superseded` |
| (7) Side effects | Event `proposal` |
| (8) Verify | "Superseded" badge |
| (9) STOP | **Yes**: retires a proposal version (history only, but visible to the team). Approver: the enquiry owner |
| (10) Retry | Refused on repeat (an already superseded version cannot be superseded again), so safe |
| (11) Surface | UI over DB function |

#### `sales.zoho.save_references`
| Field | Entry |
|---|---|
| (1) Reached | `saveZohoReference` (`crm.ts`); `crm_save_zoho_reference` (migration `20261222000100`, **applied on hosted V2 per the owner (owner-run verification, owner-reported 2026-11-09)**); **there is no fallback**: with the old database the app shows "Saving Zoho Books references is temporarily unavailable" and writes nothing (references stay readable) |
| (2) Record | `crm_zoho_references` row (one per enquiry) |
| (3) Inputs | Quote reference, quote sent on, invoice reference, invoice issued on, payment received on, amount paid. **Only the fields the person changed are sent**, each with the value they saw; an emptied field is an intentional clear, an untouched field is never sent (so never cleared) |
| (4) Permissions | Owner/founder |
| (5) Starting states | Open, on-hold and Won enquiries; **a Lost enquiry is refused** (SQLSTATE `23514`). **Decision B: clearing an existing quote reference is refused at Quote sent, Negotiation and Won (and on hold from Quote sent or Negotiation)**, SQLSTATE `23514`; correcting it to another non-blank value, other fields (invoice and payment on Won), an omitted quote reference and a first value are allowed; records at those stages with a missing reference are not backfilled and not blocked (`../../sales-crm-write-rules-deployment.md`) |
| (6) Changes | The changed fields of the row (field-level merge under the opportunity row lock); `updated_by`, `updated_at` |
| (7) Side effects | A non-blank quote reference unlocks the Quote sent stage move; reports show the references; **nothing is sent to or read from Zoho Books** |
| (8) Verify | Commercial tab shows the saved values and "Last updated"; Reports invoice and payment table |
| (9) STOP | **Yes**: records references and can unlock a stage gate. Approver: the enquiry owner, with the Zoho Books quote number from the accounting record. The Zoho side is `Unverified` |
| (10) Retry | Safe: a repeat sets the same fields to the same values; a change made by someone else to another field is kept; a stale edit of the same field is refused ("Someone else changed ... Reload to see their change"), so read the Commercial tab again before retrying that. A refused clear of the quote reference is not retried: enter the correct reference instead. **Unavailable state:** if the database function is not installed, nothing is written and retrying does not help until the migration is applied |
| (11) Surface | UI over DB function |

#### `sales.availability.request`
| Field | Entry |
|---|---|
| (1) Reached | `requestAvailability` (`crm.ts`); `crm_request_availability` |
| (2) Record | `crm_opportunities` availability columns |
| (3) Inputs | Enquiry id |
| (4) Permissions | Owner/founder |
| (5) Starting states | Open enquiry |
| (6) Changes | `availability_state = awaiting`, requester, time, `version + 1` |
| (7) Side effects | Event `availability`; appears in Inventory's "Sales checks" queue (`04` section 1.1 row 4) |
| (8) Verify | Commercial tab "Check requested by X on ..." |
| (9) STOP | No |
| (10) Retry | Repeats (resets the request time and logs again); read first |
| (11) Surface | UI over DB function |

#### `sales.availability.record_result`
| Field | Entry |
|---|---|
| (1) Reached | `confirmAvailability` (`crm.ts`); `crm_confirm_availability` |
| (2) Record | `crm_opportunities` availability columns |
| (3) Inputs | Result (confirmed or unavailable), note (required) |
| (4) Permissions | `confirm_availability` capability (founder implies); not the owner as such |
| (5) Starting states | Open enquiry |
| (6) Changes | State, who, when, note, `availability_covers` (dates and technologies the check covered), `version + 1` |
| (7) Side effects | Event `availability`; later date or technology edits show "needs repeating" |
| (8) Verify | Commercial tab Result, Checked by, "The check covered" |
| (9) STOP | **Yes**: a recorded warehouse/founder fact about stock for given dates; only the capability holder, from their own check. Approver: the person holding `confirm_availability` |
| (10) Retry | Overwrites the previous check; read first |
| (11) Surface | UI over DB function |

#### `sales.approval.request`
| Field | Entry |
|---|---|
| (1) Reached | `requestApproval` (`crm.ts`); `crm_request_approval` |
| (2) Record | New `crm_approvals` row |
| (3) Inputs | Enquiry id (the newest proposal version is attached if any) |
| (4) Permissions | Owner/founder |
| (5) Starting states | Company policy `required` (else refused); no other `pending` request |
| (6) Changes | `crm_approvals` (`pending`) |
| (7) Side effects | Event `approval` "requested"; founders see it on My Day |
| (8) Verify | Commercial tab "Waiting for a founder's decision" |
| (9) STOP | No (it asks; it decides nothing) |
| (10) Retry | Safe: a second call is refused while one is pending |
| (11) Surface | UI over DB function |

#### `sales.approval.decide`
| Field | Entry |
|---|---|
| (1) Reached | `decideApproval` (`crm.ts`); `crm_decide_approval` |
| (2) Record | `crm_approvals` row |
| (3) Inputs | Decision approved or changes_requested; instruction (required for changes) |
| (4) Permissions | **A Sales founder only**. An approval bound to an estimate cannot be approved through this function (trigger `crm_approvals_quote_guard`) |
| (5) Starting states | `pending`; policy `required` |
| (6) Changes | `state`, `decided_by`, `decided_at`, `instruction` |
| (7) Side effects | Event `approval` |
| (8) Verify | Requests-so-far list shows the decision and who decided |
| (9) STOP | **Yes**: a founder's decision; a worker must never decide. Approver: the founder |
| (10) Retry | Safe: second call refused ("already been decided") |
| (11) Surface | UI over DB function |

### 3.5 Handover (reference: [close and handover](./sales-close-and-handover.md); Projects-side steps are not catalogued here, see section 7)

#### `sales.handover.save_draft`
| Field | Entry |
|---|---|
| (1) Reached | `saveHandover` (`apps/web/src/lib/actions/projectsCore.ts`); `proj_save_handover` |
| (2) Record | `proj_handovers` row for the enquiry (one active row; created on first save) |
| (3) Inputs | Project name, client, location, site time zone, dates, scope, exclusions, risks, notes, technologies; expected version |
| (4) Permissions | Owner or a Sales founder |
| (5) Starting states | Enquiry Won; handover absent, or `draft`, `submitted`, `clarification_requested` |
| (6) Changes | The brief (created from the enquiry's non-commercial facts on first save), `version + 1` |
| (7) Side effects | None (no notice until submitted) |
| (8) Verify | Handover page panel shows status Draft and the brief |
| (9) STOP | No |
| (10) Retry | Safe through the version check on later saves; the first save creates the one active row (a second first-save updates it) |
| (11) Surface | UI over DB function |

#### `sales.handover.save_and_submit`
| Field | Entry |
|---|---|
| (1) Reached | `saveAndSubmitHandover` (`projectsCore.ts`); `proj_save_handover` then `proj_submit_handover` |
| (2) Record | `proj_handovers` row |
| (3) Inputs | As save, plus a non-empty scope |
| (4) Permissions | Save: owner or Sales founder; submit: the preparer, the sales owner, or a Sales founder |
| (5) Starting states | `draft` or `clarification_requested`; a repeat on `submitted`, `pm_assigned`, `accepted` is a no-op |
| (6) Changes | `status submitted` (or `pm_assigned` if a Project Manager is named), `submitted_at`, `revision + 1` |
| (7) Side effects | **In-app notices** `project_handover_submitted` to every founder and `assign_pm` holder, or `project_handover_resubmitted` to the named Project Manager; starts delivery. No e-mail |
| (8) Verify | Reread the saved brief: status `submitted` (or `pm_assigned` when a Project Manager is named), `submitted_at` set, revision and version moved; Projects > Handovers for the assigners (Projects screen). Distinct from Mark Won (which only creates the empty brief row) and from Accept handover (below), which is what creates the project |
| (9) STOP | **Yes**: starts delivery work and notifies people. Approver: the enquiry owner |
| (10) Retry | **Read first.** `proj_submit_handover` returns without changes when the handover is already `submitted`, `pm_assigned` or `accepted` (`20261120000200_proj_projects_handover_functions.sql:248`), but this combined action SAVES first (`saveHandoverCore`) and can bump the brief's version before submitting (`saveAndSubmitHandover`, `projectsCore.ts:83`). After an unclear result, reread the saved brief, its status and its version before retrying; a retry made with the old version is expected to be refused as a stale edit (`Unverified`: not exercised). If the submit step was refused the changes stay saved as a draft ("Your changes are saved as a draft, but it was not submitted"): read the status, do not assume it was submitted |
| (11) Surface | UI over DB functions |

#### `sales.handover.withdraw`
| Field | Entry |
|---|---|
| (1) Reached | `withdrawHandover` (`projectsCore.ts`); `proj_withdraw_handover` |
| (2) Record | `proj_handovers` row |
| (3) Inputs | Reason (required) |
| (4) Permissions | Sales (preparer or owner with Sales access) or a Projects founder |
| (5) Starting states | Not `accepted`; `withdrawn` again is a no-op |
| (6) Changes | `status withdrawn`; notes get "Withdrawn: <reason>" |
| (7) Side effects | None found (no notice) |
| (8) Verify | Panel shows no active handover (a new brief can be started) |
| (9) STOP | **Yes**: cancels delivery preparation. Approver: the enquiry owner |
| (10) Retry | Idempotent |
| (11) Surface | UI over DB function |

#### `sales.handover.update_legacy`
| Field | Entry |
|---|---|
| (1) Reached | `updateHandover` (`crm.ts`); `crm_update_handover`; only when Projects & Tasks is not installed |
| (2) Record | `crm_handovers` row |
| (3) Inputs | Status draft, ready or handed_over; Project Manager (active user; required for handed_over); notes |
| (4) Permissions | Owner/founder |
| (5) Starting states | Enquiry Won |
| (6) Changes | Status, PM, notes, `prepared_by/at`, `handed_over_at` |
| (7) Side effects | Event `handover`; **no notice, no project** |
| (8) Verify | Handover page "Project Manager and status" |
| (9) STOP | **Yes** (`handed_over` marks delivery handed over; fallback path only) |
| (10) Retry | Idempotent; repeats the event |
| (11) Surface | UI over DB function |

### 3.6 Settings and company (reference: [settings](./sales-settings.md))

#### `sales.settings.save_company`
| Field | Entry |
|---|---|
| (1) Reached | `saveCrmSettings` (`crm.ts`); `crm_upsert_settings` |
| (2) Record | `crm_company_settings` (one row per company) |
| (3) Inputs | Reference code (2 to 5 capitals, unique), default currency (3 letters), response target, calendar (days, start, end, holidays; all or none), duplicate window 1 to 1095, owner e-mail tick, approval policy and note |
| (4) Permissions | `manage_settings` (founder implies); the approval policy additionally `manage_approval_rules` |
| (5) Starting states | Company active; none otherwise |
| (6) Changes | The row (upsert); omitted policy leaves the stored one |
| (7) Side effects | Affects new references, duplicate warnings, Timeliness, the next-working-day suggestion, owner e-mails (with the environment switches), who may request and decide approvals and estimate finalising |
| (8) Verify | Reload `/sales/settings`: values and "Last changed" |
| (9) STOP | **Yes**: company-wide policy. Approver: a founder (policy: a founder or `manage_approval_rules`) |
| (10) Retry | Idempotent; overwrites whatever else was changed meanwhile |
| (11) Surface | UI over DB function |

#### `sales.settings.save_vat_choice`
| Field | Entry |
|---|---|
| (1) Reached | `saveVatChoice` (`apps/web/src/lib/actions/quotations.ts`); `crm_save_vat_choice` |
| (2) Record | `crm_quote_vat_choices` |
| (3) Inputs | Company, name (max 60), rate in percent (kind `rate`) |
| (4) Permissions | `manage_settings` (founder implies) |
| (5) Starting states | None; the screen only adds |
| (6) Changes | New choice (the function can also edit or hide; no screen does) |
| (7) Side effects | Offered on new estimates |
| (8) Verify | Estimates card list |
| (9) STOP | **Yes** (company list used on client-facing estimates). Approver: a founder |
| (10) Retry | **Duplicate risk** when adding (no unique key) |
| (11) Surface | UI over DB function |

#### `sales.company.save_issuer_details`
| Field | Entry |
|---|---|
| (1) Reached | `updateCompanyIssuerDetails` (`apps/web/src/lib/actions/companies.ts`), Admin > Companies; reference [Q section 2.4](./sales-estimates-and-quotations.md#24-admin-companies-appswebsrcappappadmincompanies) |
| (2) Record | `companies` row (issuer fields) |
| (3) Inputs | Legal name, TRN, address, phone, e-mail, website |
| (4) Permissions | System Administrator |
| (5) Starting states | None |
| (6) Changes | Issuer columns |
| (7) Side effects | Printed on **new** estimate exports; finalised ones keep their frozen issuer |
| (8) Verify | Admin Companies card; a draft export header |
| (9) STOP | **Yes**: client-visible company identity. Approver: a System Administrator / owner |
| (10) Retry | Idempotent |
| (11) Surface | UI over DB function (the update is a table write guarded by `companies_write`: `Unverified` the exact mechanism, see the Estimates reference) |

#### `sales.company.upload_logo`
| Field | Entry |
|---|---|
| (1) Reached | `uploadCompanyLogo` (`companies.ts`); `crm_set_company_logo` |
| (2) Record | `companies.logo_path` and a private storage object |
| (3) Inputs | PNG, JPEG or WebP under 900 KB (bytes checked) |
| (4) Permissions | System Administrator |
| (5) Starting states | None |
| (6) Changes | Logo path (a new path each time) |
| (7) Side effects | Printed on new estimate exports; pinned copies on finalise |
| (8) Verify | Admin Companies card; draft export |
| (9) STOP | **Yes** (client-visible) |
| (10) Retry | New path each call: leaves unused objects; read first |
| (11) Surface | UI over DB function |

### 3.7 Accounts, import and outreach (reference: [clients and agencies](./sales-clients-and-agencies.md); entries link there instead of repeating)

#### `sales.account.create`
| Field | Entry |
|---|---|
| (1) Reached | `createAccount` (`clients-agencies.ts`) -> `crm_create_organisation_profile`; [C section 2.1](./sales-clients-and-agencies.md#21-directory-appswebsrcappappsalesaccountspagetsx) |
| (2) Record | New `crm_organisations` + this company's `crm_account_profiles` + optional contacts, all or nothing |
| (3) Inputs | Name (required); roles, country, place, website, lead source, exhibition, notes, first contact, owner (only with `assign_owner`) |
| (4) Permissions | Any Sales grant; owner needs `assign_owner` and an eligible person |
| (5) Starting states | None |
| (6) Changes | The rows listed |
| (7) Side effects | Audit trail |
| (8) Verify | Account page opens; directory row |
| (9) STOP | No |
| (10) Retry | **Duplicate risk**; search the directory first |
| (11) Surface | UI over DB function |

#### `sales.account.save_profile`
| Field | Entry |
|---|---|
| (1) Reached | `saveAccountProfile` -> `crm_update_organisation`, `crm_save_account_profile`; [C section 2.2](./sales-clients-and-agencies.md#22-account-page-appswebsrcappappsalesaccountsidpagetsx) |
| (2) Record | `crm_organisations` (shared) and `crm_account_profiles` (this company) |
| (3) Inputs | Name, roles, country, website, VAT number, trade licence (max 40), place, notes, lead source, exhibition |
| (4) Permissions | Creator of the organisation, a Sales founder, or the owner of an open enquiry it is on (`crm_can_edit_organisation`); the account owner and follow-up assignee have no edit right |
| (5) Starting states | None |
| (6) Changes | The named columns; a partial result is reported ("the shared record saved but the company profile did not") |
| (7) Side effects | Changed roles can make existing enquiries inconsistent only for new edits (trigger checks on change) |
| (8) Verify | Account page shows the values |
| (9) STOP | **Conditional yes** for a name or role change (shared by all companies). Approver: the organisation's creator or a founder |
| (10) Retry | Idempotent; a partial-save message means read first |
| (11) Surface | UI over DB functions |

#### `sales.account.assign_owner`
| Field | Entry |
|---|---|
| (1) Reached | `assignAccountOwner` -> `crm_assign_account_owner`; [C section 2.2](./sales-clients-and-agencies.md#22-account-page-appswebsrcappappsalesaccountsidpagetsx) |
| (2) Record | `crm_account_profiles.owner_id` for (organisation, company) |
| (3) Inputs | Person or Unassigned; company |
| (4) Permissions | `assign_owner` or founder, in that company; the person needs an active grant |
| (5) Starting states | None |
| (6) Changes | The owner label (touches no enquiry and no follow-up) |
| (7) Side effects | Audit trail |
| (8) Verify | Account page "Account owner"; directory column |
| (9) STOP | **Yes**: assigns responsibility. Approver: a founder or the `assign_owner` holder |
| (10) Retry | Idempotent |
| (11) Surface | UI over DB function |

#### `sales.import.apply`
| Field | Entry |
|---|---|
| (1) Reached | `POST /api/sales/accounts/import` (confirm step, `apps/web/src/app/api/sales/accounts/import/route.ts`) -> `crm_import_apply`; [C sections 8.1 and 9.1](./sales-clients-and-agencies.md#91-import-safety-in-the-database) |
| (2) Record | Many `crm_organisations`, profiles, contacts, owners in one batch (up to 2000 organisations) |
| (3) Inputs | The company, the `.xlsx` workbook (4 MB, 2000 rows) and the preview's per-row fingerprints. **The caller supplies no batch key**: the server derives it as a SHA-256 of the company ID, the file hash and the sorted fingerprints (`batchKeyFor`, `apps/web/src/lib/crm/clients-agencies/import/apply.ts:44`, called from `import/service.ts:131`) and passes it to `crm_import_apply` as `p_batch_key` |
| (4) Permissions | Sales grant for the company; per row the edit rules; owner assignment needs `assign_owner` |
| (5) Starting states | The preview must still match: otherwise **nothing** is applied (`preview_stale`) |
| (6) Changes | Creates new organisations, fills only empty fields, adds contacts, assigns verified owners; never overwrites |
| (7) Side effects | One `crm_import_batches` row; advisory locks per name and website domain |
| (8) Verify | The Result screen counts; directory search for sample rows; re-running a preview shows "nothing to change" |
| (9) STOP | **Yes**: bulk change of many shared records. Approver: a founder or the data owner; only after the person has seen the preview counts |
| (10) Retry | **Replaying the exact same request** (same company, same workbook bytes, same fingerprints), for example after a timeout, derives the same key, so the database returns the first result (`repeated: true`) and changes nothing more. **A fresh preview is not a replay**: it recomputes the fingerprints against the database as it is now and may describe a new batch (a different key). If the confirm answers `preview_stale`, nothing was applied: get a fresh preview and have a person review its counts before confirming again; do not resubmit the stale request. After an unclear result, read the Result screen or search the directory before acting again |
| (11) Surface | UI/API over DB function |

#### `sales.outreach.assign`
| Field | Entry |
|---|---|
| (1) Reached | `assignOutreach` (`apps/web/src/lib/actions/outreach.ts`) -> `crm_assign_outreach`; [C section 10.1](./sales-clients-and-agencies.md#101-control-reference) |
| (2) Record | `crm_outreach` rows (one open per account per company) |
| (3) Inputs | Up to 200 accounts, assignee, target date (required), objective (500 chars) |
| (4) Permissions | `assign_owner` (founder implies); assignee needs a grant |
| (5) Starting states | Account not archived; a second assignment REASSIGNS the open outreach |
| (6) Changes | `crm_outreach` + `crm_outreach_events` ("assigned" or "reassigned") |
| (7) Side effects | The new assignee reads the full history, the former assignee loses access to it; no notification |
| (8) Verify | `/sales/outreach` All outreach and the account page |
| (9) STOP | **Yes**: bulk assignment of work to a person. Approver: a founder or the `assign_owner` holder |
| (10) Retry | Idempotent per account ("already" for the same person) under an advisory lock |
| (11) Surface | UI over DB function |

#### `sales.outreach.log_activity`
| Field | Entry |
|---|---|
| (1) Reached | `logOutreachActivity` -> `crm_outreach_log`; [C section 10.1](./sales-clients-and-agencies.md#101-control-reference) |
| (2) Record | `crm_outreach_events` |
| (3) Inputs | Kind (call, email, meeting), date (not in the future), outcome that fits the kind (required), note (1000), optional next action and due date |
| (4) Permissions | The assignee or an `assign_owner` holder |
| (5) Starting states | Outreach not closed |
| (6) Changes | Event row; last contact; the first activity moves Not started to In progress |
| (7) Side effects | None external |
| (8) Verify | Account page Outreach history |
| (9) STOP | No |
| (10) Retry | **Duplicate risk** |
| (11) Surface | UI over DB function |

#### `sales.outreach.set_next_action`
| Field | Entry |
|---|---|
| (1) Reached | `setOutreachNextAction` -> `crm_outreach_set_next` |
| (2) Record | `crm_outreach` |
| (3) Inputs | Text (300), due date |
| (4) Permissions | The assignee or an `assign_owner` holder |
| (5) Starting states | Not closed |
| (6) Changes | Next action and due; history entry |
| (7) Side effects | None |
| (8) Verify | Outreach card "Next action" |
| (9) STOP | No |
| (10) Retry | Idempotent (repeats the history entry) |
| (11) Surface | UI over DB function |

#### `sales.outreach.set_status`
| Field | Entry |
|---|---|
| (1) Reached | `setOutreachStatus` -> `crm_outreach_set_status` |
| (2) Record | `crm_outreach` |
| (3) Inputs | Status (not started, in progress, waiting for reply, meeting booked, closed); closing needs a reason (500) |
| (4) Permissions | The assignee or an `assign_owner` holder |
| (5) Starting states | Not closed; Inquiry raised can only be followed by Closed |
| (6) Changes | Status; history entry; Closed is final |
| (7) Side effects | None |
| (8) Verify | Status badge |
| (9) STOP | **Conditional yes** for Closed (final). Approver: the assignee or a lead |
| (10) Retry | Idempotent (same status returns without change) |
| (11) Surface | UI over DB function |

#### `sales.outreach.link_inquiry`
| Field | Entry |
|---|---|
| (1) Reached | `linkOutreachInquiry` -> `crm_outreach_link_inquiry` (also called by `createOpportunity` for "Create inquiry") |
| (2) Record | `crm_outreach` |
| (3) Inputs | An enquiry of the same company on which the account is agency or end client |
| (4) Permissions | The assignee or an `assign_owner` holder |
| (5) Starting states | Outreach open |
| (6) Changes | `opportunity_id`; status Inquiry raised |
| (7) Side effects | Events `inquiry_linked` and a status event |
| (8) Verify | Outreach card shows the linked enquiry |
| (9) STOP | No |
| (10) Retry | Repeats the event; sets the same link: read first |
| (11) Surface | UI over DB function |

### 3.8 Estimates (reference: [estimates](./sales-estimates-and-quotations.md); entries link there)

All estimate edits go through `crm_quote_load_editable` (owner/founder, estimate not finalised, enquiry open: "An issued quotation cannot be edited. Create a revision instead." errcode 55000; "A closed opportunity cannot change quotations"). Server actions are in `apps/web/src/lib/actions/quotations.ts`.

#### `sales.estimate.create`
| Field | Entry |
|---|---|
| (1) Reached | `createQuotation`; `crm_quote_create` then `crm_quote_save_header` (format marker) |
| (2) Record | New `crm_proposals` row + `crm_quotations` extension; reference `EST-<code>-<year>-<nnnn>` |
| (3) Inputs | Enquiry id |
| (4) Permissions | Owner/founder |
| (5) Starting states | Enquiry not Won/Lost; company Sales settings exist |
| (6) Changes | The two rows; `crm_quote_counters` |
| (7) Side effects | Event `proposal` "vN estimate draft"; **nothing is sent** |
| (8) Verify | Estimates tab; the estimate page opens in Details |
| (9) STOP | No |
| (10) Retry | **Duplicate risk** (another estimate and number) |
| (11) Surface | UI over DB functions |

#### `sales.estimate.save_draft`
| Field | Entry |
|---|---|
| (1) Reached | `saveEstimateDraft` -> `crm_quote_save_header`, `crm_quote_save_section`, `crm_quote_save_line` |
| (2) Record | The draft estimate header, sections and lines |
| (3) Inputs | Details, items (description, unit, quantity, unit price, VAT), optional blocks |
| (4) Permissions | Owner/founder |
| (5) Starting states | Draft estimate; open enquiry |
| (6) Changes | Header, sections, lines (last write wins; content hash changes) |
| (7) Side effects | A pending approval bound to the old content is withdrawn when approval is requested again |
| (8) Verify | Reload the estimate page; totals |
| (9) STOP | No |
| (10) Retry | Idempotent for the same content; may create a section if a retry runs after a partial failure: read first |
| (11) Surface | UI over DB functions |

#### `sales.estimate.save_section`
| Field | Entry |
|---|---|
| (1) Reached | `saveQuotationSection` -> `crm_quote_save_section` (`apps/web/src/lib/actions/quotations.ts`) |
| (2) Record | A section of the draft estimate (new when no id is given) |
| (3) Inputs | Section title (and section id to rename) |
| (4) Permissions | Owner/founder (`crm_quote_load_editable`) |
| (5) Starting states | Draft estimate; open enquiry (refused: finalised, Won, Lost) |
| (6) Changes | Creates or renames a `crm_quotation_sections` row |
| (7) Side effects | Content hash changes (an approval requested earlier no longer matches); none external |
| (8) Verify | Section heading on the estimate page |
| (9) STOP | No |
| (10) Retry | Rename with an id: idempotent; create without an id: **duplicate risk** |
| (11) Surface | UI over DB function |

#### `sales.estimate.delete_section`
| Field | Entry |
|---|---|
| (1) Reached | `deleteQuotationSection` -> `crm_quote_delete_section` (`apps/web/src/lib/actions/quotations.ts`) |
| (2) Record | One `crm_quotation_sections` row by id |
| (3) Inputs | Section id |
| (4) Permissions | Owner/founder (`crm_quote_load_editable`) |
| (5) Starting states | Draft estimate; open enquiry (refused: finalised, Won, Lost) |
| (6) Changes | Deletes the section **and all its items** (`crm_quote_delete_section` deletes `crm_quotation_lines` of the section first) |
| (7) Side effects | Content hash changes (an approval requested earlier no longer matches); none external |
| (8) Verify | The section is gone from the estimate page |
| (9) STOP | **Conditional yes**: deletes the section's items too; confirm with the person |
| (10) Retry | Second call refused (not found) |
| (11) Surface | UI over DB function |

#### `sales.estimate.delete_line`
| Field | Entry |
|---|---|
| (1) Reached | `deleteQuotationLine` -> `crm_quote_delete_line` (`apps/web/src/lib/actions/quotations.ts`) |
| (2) Record | One `crm_quotation_lines` row by id |
| (3) Inputs | Line id |
| (4) Permissions | Owner/founder (`crm_quote_load_editable`) |
| (5) Starting states | Draft estimate; open enquiry (refused: finalised, Won, Lost) |
| (6) Changes | Deletes the item from the draft |
| (7) Side effects | Content hash changes (an approval requested earlier no longer matches); none external |
| (8) Verify | The item is gone; totals change |
| (9) STOP | Conditional yes: confirm with the person |
| (10) Retry | Second call refused (not found) |
| (11) Surface | UI over DB function |

#### `sales.estimate.set_line_image`
| Field | Entry |
|---|---|
| (1) Reached | `setQuotationLineImage` -> `crm_quote_save_line` (patch `image_file_id`) (`apps/web/src/lib/actions/quotations.ts`) |
| (2) Record | One `crm_quotation_lines` row |
| (3) Inputs | Line id, section id, an enquiry file id (uploaded first with `sales.enquiry.upload_file`) or none |
| (4) Permissions | Owner/founder (`crm_quote_load_editable`) |
| (5) Starting states | Draft estimate; open enquiry (refused: finalised, Won, Lost) |
| (6) Changes | Sets or clears the item's picture |
| (7) Side effects | Content hash changes (an approval requested earlier no longer matches); none external |
| (8) Verify | The picture shows on the line and in a draft export |
| (9) STOP | No |
| (10) Retry | Idempotent |
| (11) Surface | UI over DB function |

#### `sales.estimate.reorder`
| Field | Entry |
|---|---|
| (1) Reached | `reorderQuotation` -> `crm_quote_reorder` (`apps/web/src/lib/actions/quotations.ts`) |
| (2) Record | Sections or lines of a draft estimate |
| (3) Inputs | Kind (sections or lines), scope, ordered ids |
| (4) Permissions | Owner/founder (`crm_quote_load_editable`) |
| (5) Starting states | Draft estimate; open enquiry (refused: finalised, Won, Lost) |
| (6) Changes | Positions |
| (7) Side effects | Content hash changes (an approval requested earlier no longer matches); none external |
| (8) Verify | The new order on the page |
| (9) STOP | No |
| (10) Retry | Idempotent |
| (11) Surface | UI over DB function |

#### `sales.estimate.request_approval`
| Field | Entry |
|---|---|
| (1) Reached | `requestQuotationApproval` -> `crm_quote_request_approval` -> `crm_request_approval` |
| (2) Record | New `crm_approvals` row bound to the estimate's content hash |
| (3) Inputs | Estimate id |
| (4) Permissions | Owner/founder |
| (5) Starting states | Draft estimate; policy `required`; none pending (an older pending request for different content is withdrawn automatically) |
| (6) Changes | `crm_approvals` (`pending`, `quote_content_hash`) |
| (7) Side effects | Event `approval`; founders see it on My Day |
| (8) Verify | Estimate page "Waiting for a founder" |
| (9) STOP | No |
| (10) Retry | Safe: refused while one is pending for the same content |
| (11) Surface | UI over DB function |

#### `sales.estimate.decide_approval`
| Field | Entry |
|---|---|
| (1) Reached | `decideQuotationApproval` -> `crm_quote_decide_approval` -> `crm_decide_approval` |
| (2) Record | `crm_approvals` row |
| (3) Inputs | Decision, instruction, and the content hash the reviewer's screen was rendered with |
| (4) Permissions | A Sales founder only |
| (5) Starting states | `pending`, and the content unchanged since the request and since the screen was opened (else refused: "changed after you opened it") |
| (6) Changes | `state`, `decided_by`, `decided_at` |
| (7) Side effects | Event `approval` |
| (8) Verify | Estimate page approval line |
| (9) STOP | **Yes**: founder decision. A worker must never decide |
| (10) Retry | Safe: second call refused |
| (11) Surface | UI over DB function |

#### `sales.estimate.finalise`
| Field | Entry |
|---|---|
| (1) Reached | `issueQuotation` -> `crm_quote_issue` (UI word: Finalise); pinned pictures are copied first by the server |
| (2) Record | The estimate: `crm_quotations.issued_at`, a frozen `crm_quotation_snapshots` row |
| (3) Inputs | Complete estimate: currency, VAT, bill-to, at least one item, no empty section, valid dates, milestones adding up; issuing company has a legal name |
| (4) Permissions | Owner/founder; if policy `required`, a founder's approval of this exact content |
| (5) Starting states | Draft estimate; open enquiry |
| (6) Changes | `issued_at`, `issued_by`, `issue_date`; snapshot (immutable); **earlier revisions of the same reference that were draft or sent become superseded** |
| (7) Side effects | Event `proposal` "<ref> rev N issued"; **changes no stage and creates no reservation or Zoho row; sends nothing**; exports now come from the frozen snapshot |
| (8) Verify | Estimate page shows "finalised"; the PDF download carries no DRAFT marking; the Estimates tab badge |
| (9) STOP | **Yes**: freezes a client-facing document and supersedes earlier revisions; irreversible (a change needs a new revision). Approver: the enquiry owner (and a founder where policy requires) |
| (10) Retry | **Read first.** The database refuses a second finalisation (`crm_quote_issue` loads the estimate through `crm_quote_load_editable`, which refuses a finalised one), but the server copies the logo and item pictures (`pinAssets` in `issueQuotation`, `apps/web/src/lib/actions/quotations.ts`) BEFORE it calls the function, so a repeat can repeat that copying. After an unclear result (timeout, error page), reread the estimate and check whether its frozen snapshot exists (the page shows "finalised", the badge, a download without DRAFT marking) before retrying; retry only while it is still a draft. Clean-up of pinned copies made before a failed finalise: `Unverified`. Finalising sends nothing, reserves nothing and does not move the enquiry stage (see rows 6 and 7) |
| (11) Surface | UI over DB function |

#### `sales.estimate.create_revision`
| Field | Entry |
|---|---|
| (1) Reached | `createQuotationRevision` -> `crm_quote_create_revision` |
| (2) Record | New draft revision (same reference, revision + 1) |
| (3) Inputs | A finalised estimate |
| (4) Permissions | Owner/founder |
| (5) Starting states | Estimate finalised; no unissued revision exists; enquiry open |
| (6) Changes | New `crm_proposals` + `crm_quotations` + copied sections and lines |
| (7) Side effects | Event `proposal` "<ref> rev N draft"; the copy needs its own approval and its own finalise |
| (8) Verify | New version in the list |
| (9) STOP | No |
| (10) Retry | Safe: a second call is refused ("already an unissued revision") |
| (11) Surface | UI over DB function |

### 3.9 JARVIS actions (reference: [JARVIS](./jarvis.md); surface "JARVIS action")

JARVIS is the Enginious OS assistant (OFF by default, owner-switched pilot; **not** hosted-applied). A JARVIS action is a **typed, registered** action reached only from the JARVIS panel's review card: `propose` never writes, a server-issued **proof** (a keyed MAC over the person, company, action, target, version, expiry, proof id and the exact payload text) binds the reviewed values, and the write goes through ONE definer function that **verifies that proof inside the database first** (a confirmation id and hash invented by a caller write nothing; no proof key set = fail closed), then records a ledger row and calls the existing function in the same transaction ([`jarvis.md`](./jarvis.md) section 6.1). Worker rule 4 applies unchanged: **stop-and-ask is "yes" for every write**: the person reviews and presses the button. "Disabled" actions are registered (so the panel lists them as "Not available yet") and refuse every call.

**Stages 2 to 4 (PR #77, merged 2026-11-11 as `720f785`):** three more JARVIS capabilities exist and **none of them changes data, so none is a catalogue action**: `jarvis.sales.lookup.run` (follow-ups, open enquiries, enquiries with no recorded activity, one enquiry's status, what needs attention), `jarvis.sales.summary.run` (count-based summaries for a period and a summary of one enquiry) and `jarvis.sales.estimate.scope_draft` (scope wording to copy; no prices, no estimate created). Reference: [`jarvis.md`](./jarvis.md) section 15; rules: [`jarvis-rulebook.md`](./jarvis-rulebook.md) sections 2 and 3. The six write and draft entries below are unchanged in what they may do. **Every other action in this catalogue is NOT a JARVIS tool**: Won, Lost, hold, resume, reopen, handover, owner and access changes, shared-contact edits, imports, file removal, financial approval and everything about estimates and proposals except scope wording stay on their screens; JARVIS explains and links. For the entries below, the provider rule is now provenance: a working price, budget, rate or cost the person supplies goes with their text; nothing from the record is attached by these six actions.

**Milestone 3 (PR #74, merged 2026-11-10 as `b7fc31e`):** the rules for every JARVIS capability are now in [`jarvis-rulebook.md`](./jarvis-rulebook.md), enforced by the server. Two capabilities were added that change no data and are therefore not catalogue actions: `jarvis.sales.chat.reply` (general answers and drafts to copy; reads no record) and `jarvis.sales.followups.overdue` (a read-only list of the signed-in person's own open overdue follow-ups for the selected company; see [`sales-followups.md`](./sales-followups.md) for the page it mirrors). `jarvis.sales.help.answer` now answers only from the published staff guidance and calls no provider. For the entries below (rulebook section 3): the text a person submits for the task goes to the provider as written, prices, rates and client budgets included; nothing from the enquiry record is attached (`draft_reply` and `update` send only the pasted text or the request); genuinely restricted material and a brief marked as not for external sharing are not sent; `create_from_brief` puts the model's **summary** in the Brief field of the review card (accepted only when it is a summary: the pasted text handed back is refused and a sentence instructing JARVIS is dropped); **when there is no usable summary the card says so and the Brief field holds the person's own text, explicitly labelled as not a summary** (empty when it does not fit); the pasted text itself is not saved; the value is filled only from one clearly stated client budget, and "Agency call (outbound)" is kept as the source only when the text shows Enginious made the contact (rulebook section 3.1; `apps/web/src/lib/jarvis/sales/brief-outbound.ts`, `enquiry-create-from-brief.ts`).

#### `jarvis.sales.enquiry.create_from_brief`
| Field | Entry |
|---|---|
| (1) Reached | The JARVIS panel (launcher, right edge): paste a brief, review the card, press **Create enquiry**. Server actions `jarvisSend`, `jarvisReview`, `jarvisConfirm`, `jarvisStatus` (`apps/web/src/lib/actions/jarvis.ts`); action `apps/web/src/lib/jarvis/sales/enquiry-create-from-brief.ts`; database wrapper `jarvis_create_enquiry` (`20261223000100_jarvis_platform.sql`), which verifies the database proof (issued by the server only inside the confirmation request, never given to the browser) and then calls `crm_create_opportunity` |
| (2) Record | New `crm_opportunities` row (same as `sales.enquiry.create`); a `jarvis_action_ledger` row keyed by the confirmation id |
| (3) Inputs | The `sales.enquiry.create` field set (title, source, agency and/or end client, currency, value, budget note, brief summary, dates, location, technologies, scope, waiting on, next action title, date, type). Owner is always the approver. Organisations are chosen from visible, role-correct records: **never created**. Contacts: none (added on the page) |
| (4) Permissions | JARVIS pilot on (global switch, allowlist, company list), write switch on, an active Sales grant for the company, then the existing rules of `crm_create_opportunity` (company settings, organisation roles, technologies). Refused: everyone else, with no side effect; the wrapper adds no privilege |
| (5) Starting states | None (creates). The company must have Sales settings; likely duplicates must be acknowledged on the card |
| (6) Changes | As `sales.enquiry.create` (enquiry, reference counter, first open follow-up for the approver) plus the ledger row |
| (7) Side effects | Events `created` and a second `created` event "created through JARVIS" (actor = the approver). The pasted brief is sent to the AI provider; **nothing is stored of it** (no text in the ledger, no chat history) |
| (8) Verify | The panel shows the real reference only after reading the enquiry back; then as `sales.enquiry.create` (page, stage New enquiry, owner = approver, one open follow-up, two timeline lines) |
| (9) STOP | **Yes**: the person must review the card and press Create enquiry; a chat message can never confirm. Ask if a duplicate is flagged |
| (10) Retry | **Idempotent per confirmation id (the jti in the review token and in every database proof derived from it)**: a repeat of the confirmation request with the same review token (double click, retry after a timeout, restart) within its 15 minutes gets a FRESH short-lived database proof for the SAME confirmation id and returns the ORIGINAL result, creating nothing; any edited value needs a new proposal and a NEW review token (refused by the app as `values_changed`; an old proof cannot be reused with a modified payload and the database refuses it). After an unknown answer use the read-only status ("Checking the original result"); never create again |
| (11) Surface | **JARVIS action** (UI-only, through the panel); not callable by the model or by chat text |

Part 2 added the other six Sales actions, **all enabled when the pilot is on** (simulated provider only; live provider unverified). They share the platform of the entry above: `propose` never writes and returns only a **review token** (verified by the app server alone; useless to the database); the **database proof** (person, company, action, target, the exact payload text, the same confirmation id and (update, status) the record version) is issued by the server only inside the explicit confirmation request, after it re-verified the token, the access and the values, is never returned to the browser, and is **verified inside the database by every write wrapper before anything is written**; every write is ONE definer wrapper (`20261223000100_jarvis_platform.sql`, helpers `jarvis_ledger_enter/_done/_fail`) that records the ledger row and calls the existing function(s) in the same transaction. Stop-and-ask is "yes" for every write. Reference: [`jarvis.md`](./jarvis.md) section 2.

#### `jarvis.sales.draft_reply`
| Field | Entry |
|---|---|
| (1) Reached | JARVIS panel, mode "Draft a reply", on an enquiry page (or with its reference); `apps/web/src/lib/jarvis/sales/draft-reply.ts` |
| (2) Record | None written. Read: the enquiry and its organisation names (the person's own session) |
| (3) Inputs | An authorised enquiry plus the pasted conversation (provider gets the enquiry's reply facts and the text; never the internal value, owner or ids) |
| (4) Permissions | JARVIS pilot on (global switch, allowlist, company list) and an active Sales grant for the company; the enquiry visible in the selected company. No write switch needed (it writes nothing) |
| (5) Starting states | Any enquiry the person can see, not of another company |
| (6) Changes | Nothing |
| (7) Side effects | None. A draft (subject, body) with a Copy button; unconfirmed prices, dates, availability and promises listed above it by code |
| (8) Verify | Panel only |
| (9) STOP | No confirmation exists (nothing to confirm); the person reads and copies. Never sent: JARVIS has no send and no inbox |
| (10) Retry | Not a write: repeat freely (each draft counts one against the daily limit) |
| (11) Surface | **JARVIS action** (UI-only, through the panel); not callable by the model or by chat text |

#### `jarvis.sales.help.answer`
| Field | Entry |
|---|---|
| (1) Reached | JARVIS panel, mode "Ask how something works" or a short how-to sentence; `sales/help-answer.ts`, `help/guidance.ts` |
| (2) Record | None; reads no record |
| (3) Inputs | A question (max 1000 characters). Answered from reviewed guidance (no provider) or, for a general non-app question, by the model with the question alone |
| (4) Permissions | JARVIS pilot on (global switch, allowlist, company list) and an active Sales grant for the company (to open the panel) |
| (5) Starting states | Any |
| (6) Changes | Nothing |
| (7) Side effects | None. Shows the guidance with links to real screens |
| (8) Verify | Panel only |
| (9) STOP | No confirmation (read only) |
| (10) Retry | Read only: repeat freely |
| (11) Surface | **JARVIS action** (UI-only, through the panel); not callable by the model or by chat text |

#### `jarvis.sales.organisation.register`
| Field | Entry |
|---|---|
| (1) Reached | JARVIS panel, mode "Register a client or agency"; `sales/organisation-register.ts`; wrapper `jarvis_register_organisation` |
| (2) Record | New `crm_organisations` row with this company's account profile (same as the Clients & Agencies create); a ledger row |
| (3) Inputs | Name, then (separate step) type (agency, direct, end client, technology; at least one), country, website, place, note. No owner, lead source, exhibition or contacts |
| (4) Permissions | JARVIS pilot on (global switch, allowlist, company list) and an active Sales grant for the company + the write switch; then the existing rules of `crm_create_organisation_profile` |
| (5) Starting states | No same-name or same-website organisation unless the person ticked it as different |
| (6) Changes | As Clients & Agencies create (organisation, profile) |
| (7) Side effects | None beyond the ledger |
| (8) Verify | The panel shows the real name only after reading the organisation back; a link to its account page |
| (9) STOP | **Yes**: the details card has its own button; a same-name organisation needs an explicit "different" tick |
| (10) Retry | **Idempotent per confirmation id (jti)**: a repeat returns the ORIGINAL result; N parallel calls create one; after an unknown answer use the read-only status |
| (11) Surface | **JARVIS action** (UI-only, through the panel); not callable by the model or by chat text |

#### `jarvis.sales.enquiry.update`
| Field | Entry |
|---|---|
| (1) Reached | JARVIS panel, mode "Update an enquiry", on an enquiry page; `sales/enquiry-update.ts`; wrapper `jarvis_update_enquiry` |
| (2) Record | The enquiry (existing row); a ledger row |
| (3) Inputs | ONLY: title, brief, event start, event end, installation, location, technologies, scope, waiting on, budget note (the allowlist, in code and SQL). Not: owner, stage, agency, end client, value, currency, payment terms, exclusions, risks, evidence, files, proposals, Zoho, handover, closure |
| (4) Permissions | JARVIS pilot on (global switch, allowlist, company list) and an active Sales grant for the company + the write switch; then `crm_update_opportunity`: the owner or a Sales founder; refused for a Lost enquiry |
| (5) Starting states | The record version must still be the reviewed one |
| (6) Changes | As `sales.enquiry.edit_details` for those fields (version +1) |
| (7) Side effects | The usual "Details changed" event plus one "Changed through JARVIS" event (actor = approver) |
| (8) Verify | Read back; the card showed before -> after |
| (9) STOP | **Yes**: Save changes; a changed enquiry needs a fresh review |
| (10) Retry | **Idempotent per confirmation id (jti)**; a repeat returns the original although the version moved on; a stale version is refused (by the app and by the database, which writes nothing for it) and shown; an edited value needs a new proof |
| (11) Surface | **JARVIS action** (UI-only, through the panel); not callable by the model or by chat text |

#### `jarvis.sales.enquiry.change_stage`
| Field | Entry |
|---|---|
| (1) Reached | JARVIS panel, mode "Change status", on an enquiry page; `sales/enquiry-stage.ts`; wrapper `jarvis_change_stage` |
| (2) Record | The enquiry; a ledger row |
| (3) Inputs | The stage, ONE step in either direction among the six working stages. Proposal sent only with a proposal recorded as sent or accepted; Quote sent only with the Zoho quote reference. Won, Lost, On hold, reopen, handover: never (see `jarvis.md` section 2.2) |
| (4) Permissions | JARVIS pilot on (global switch, allowlist, company list) and an active Sales grant for the company + the write switch; then `crm_move_stage`: the owner or a Sales founder; closed or on-hold refused |
| (5) Starting states | The record version must still be the reviewed one |
| (6) Changes | As `sales.enquiry.move_stage` (stage, stage_changed_at, version +1) |
| (7) Side effects | The usual "Stage changed" event plus one JARVIS event; the open follow-up is untouched |
| (8) Verify | Read back; the card showed current and proposed stage, the evidence and the effects |
| (9) STOP | **Yes**: Move; a changed enquiry needs a fresh review |
| (10) Retry | **Idempotent per confirmation id (jti)**; stale version refused (nothing written); the database's own gates apply and are shown |
| (11) Surface | **JARVIS action** (UI-only, through the panel); not callable by the model or by chat text |

#### `jarvis.sales.meeting.record`
| Field | Entry |
|---|---|
| (1) Reached | JARVIS panel, mode "Meeting notes", on an enquiry page; `sales/meeting-record.ts`; wrapper `jarvis_record_meeting` |
| (2) Record | A `crm_activities` row and (optionally) a `crm_follow_ups` row on the enquiry; a ledger row |
| (3) Inputs | Notes (provider gets only the notes). Activity: type, text, optional date, internal flag. Follow-up: title, date, time, type, assigned to the approver. A date is accepted only if the notes state it; otherwise the card asks |
| (4) Permissions | JARVIS pilot on (global switch, allowlist, company list) and an active Sales grant for the company + the write switch; then `crm_add_activity` (any Sales access; Lost refused) and `crm_create_follow_up` (a Won or Lost enquiry has none) |
| (5) Starting states | Not Lost; no follow-up on a Won enquiry |
| (6) Changes | As Add update with Plan the next step, in one transaction |
| (7) Side effects | One "through JARVIS" event |
| (8) Verify | Read back; the card showed both items |
| (9) STOP | **Yes**: ONE button saves both or neither (no half-state) |
| (10) Retry | **Idempotent per confirmation id (jti)**; both writes commit together or not at all |
| (11) Surface | **JARVIS action** (UI-only, through the panel); not callable by the model or by chat text |

## 4. Actions that communicate outside the system

| Action or job | Reaches outside? | What leaves, to whom |
|---|---|---|
| **No automatic e-mail exists in the estimate flow.** Creating, approving, finalising or exporting an estimate sends nothing; `sendMailAsUser` is called only from `apps/web/src/lib/crm/reminders.ts` among Sales files (HR leave and approval mail is separate: `lib/actions/leave.ts`, `approvals.ts`) | No | Staff download the PDF or Excel and share it themselves. A person doing so is the external communication; it is outside the system and not recorded by it |
| Estimate PDF / Excel download (section 5) | Only when a person shares the file | The file contains the client's name, prices and the issuer's details |
| Accounts export (section 5) | Only when a person shares the file | Names, e-mail addresses and phone numbers of contacts |
| `sales.proposal.record_sent`, `sales.enquiry.move_stage` to Proposal sent or Quote sent | **No**; they record that a person sent something | Nothing is sent by the system |
| `sales.zoho.save_references` | **No**. Zoho Books is a recorded reference only: no Zoho API host or setting exists in the repository. The Zoho side is `Unverified` (hosted, outside the app) | Nothing |
| `sales.enquiry.add_link` | No | The app stores the address and never fetches it |
| Reminder e-mail (internal job, section 6) | **Yes, to Enginious staff only, never to clients**, when `CRM_REMINDER_EMAILS=on`, `CRM_REMINDER_FROM_EMAIL` is set and the company switch is on | A "Follow-up due / overdue / Hold review due / No next action" message to the enquiry owner or assignee through Microsoft Graph. Hosted state `Unverified` |
| In-app notices from handover steps | Inside the system | Rows in `notifications` for founders, `assign_pm` holders, the Project Manager, the sales owner and the preparer |

## 5. Read-only actions (no catalogue risk beyond data exposure)

| Read-only action | Reached through | Who can run it | What it exposes | Notes |
|---|---|---|---|---|
| Accounts export, filtered or all | `GET /api/sales/accounts/export?scope=filtered|all` (`routes.test.ts`) | Any Sales grant for the company | One row per contact: organisation columns, contact name, job title, e-mail, phone; sheet "Summary (read-only)" with counts; the owner column shows the work e-mail **only when the database shows e-mail addresses to the exporter (a Sales founder)**, otherwise the owner's name labelled "not imported" | 401 signed out, 403 without a grant, 503 on a failed read (never a partial or silently unfiltered file); text starting with `=`, `+`, `-`, `@` is neutralised against spreadsheet formulas ([C section 8.1](./sales-clients-and-agencies.md#81-control-reference)) |
| Import template | `GET /api/sales/accounts/import/template` | Any Sales grant | Headers and three clearly fictional example rows | |
| Import preview | `POST /api/sales/accounts/import` (preview mode) | Any Sales grant for the company | Counts and the matches it found against existing organisations | Writes nothing; `crm_import_fingerprints` is read-only |
| Estimate PDF / Excel | `GET /api/sales/quotations/[proposalId]/pdf` and `/xlsx` | Any Sales grant for the estimate's company | A finalised revision only from its frozen snapshot; a draft from the live draft and marked DRAFT everywhere; **never** internal notes, costs, margin, supplier prices, approvals or audit data ([Q Export](./sales-estimates-and-quotations.md#export-pdf-and-excel)) | `Content-Disposition: attachment`, `Cache-Control: private, no-store`; 404 if unreadable, 403 without a grant for that company, 503 if the issued copy cannot be read (never a fallback to live data) |
| Open a stored file | `getCrmFileUrl` (`crmFiles.ts`) | Any Sales grant who can read the file row | A 60-second signed link to the file; the link is never stored | Anyone holding the link can download it during that minute: do not paste it elsewhere |
| Enquiry list, board, reports, follow-ups, proposals list, accounts directory, outreach worklists, side panel | The pages in the coverage index | Any Sales grant (outreach: assignee or lead) | Values, owners, contacts of the person's companies | Reports and list views have no download; a worker's screenshot or copy is a disclosure |

## 6. Internal functions (not tools)

**No worker should call any function in this section directly.** They are called only by database policies, triggers, other functions or the app's own server code, under rules the app sets.

| Function / job | Purpose | Called by | Source |
|---|---|---|---|
| `crm_has_access`, `crm_has_capability`, `crm_is_founder`, `crm_has_any_access`, `crm_is_any_founder`, `crm_accessible_company_ids`, `crm_capability_list` | Access tests used by every policy and function | RLS policies, other functions | `20261115000000_crm_access_audit_settings.sql` |
| `crm_audit_trigger` | Writes the Sales audit trail | Triggers on tables | same |
| `crm_require_user`, `crm_today_dubai`, `crm_lock_opportunity`, `crm_check_version`, `crm_require_owner_or_founder`, `crm_log_event`, `crm_user_has_company_access`, `crm_validate_technologies`, `crm_stage_index`, `crm_require_follow_up_actor`, `crm_can_edit_contact` | Definer helpers inside the workflow functions | The functions in section 3 | `20261115000200_crm_workflow_functions.sql` |
| `crm_find_similar_organisations`, `crm_find_duplicate_candidates`, `crm_people`, `crm_staff_directory` | Read-only helpers for hints and pickers | Server actions `findSimilarOrganisations`, `checkDuplicates`, `getCrmContext`, handover page | `20261115000200`, `20261115000300` |
| `crm_availability_needs_recheck`, `crm_allowed_mime_types`, `crm_file_name_blocked` | Core-table triggers and checks | Table triggers and CHECKs | `20261115000100_crm_core_tables.sql` |
| `crm_generate_reminders`, `crm_claim_reminder_emails`, `crm_finish_reminder_email` | The reminder sweep and e-mail queue (service role only) | `runCrmReminders` (cron `GET /api/cron/crm-reminders`) and `generateRemindersThrottled` | `20261115000300_crm_proposals_files_reminders.sql`, `apps/web/src/lib/crm/reminders.ts` |
| `crm_mark_upload_intent`, `crm_expire_upload_intents` | Upload quarantine bookkeeping and the daily sweep (service role) | `finalizeCrmUpload`, `purgeExpiredUploads` | same, `lib/crm/upload-cleanup.ts` |
| `crm_register_file`, `crm_create_upload_intent`, `crm_get_upload_intent`, `crm_register_uploaded_file` | File registration steps | Only via `addLink` and the two upload server actions | same |
| `crm_organisations_sync_kind`, `crm_opportunities_check_party_roles` (trigger `crm_opportunities_party_roles`), `crm_organisation_roles`, `crm_can_edit_organisation`, `crm_require_account_follow_up_actor`, `crm_outreach_acting_on`, `crm_outreach_events_guard` | Role sync, role guard, edit-right helpers, outreach guards | Triggers and the account and outreach functions | `20261219000100_crm_clients_agencies.sql` |
| `crm_import_name_key`, `crm_import_domain`, `crm_import_candidates`, `crm_import_fingerprint`, `crm_import_fingerprints`, `crm_import_clean_contacts`, `crm_import_apply_item` | Import matching and per-row apply | `crm_import_apply` and the preview route | same, `20261220000100` |
| `crm_estimate_sent_guard` (trigger `crm_proposals_estimate_sent_guard`) | Database refusal: an estimate cannot be marked sent | Trigger on `crm_proposals` | `20261221000100_crm_estimates_only_guards.sql` |
| `crm_quotation_frozen`, `crm_quotation_guard`, `crm_quotation_body_guard`, `crm_quotation_assets_guard`, `crm_approval_quote_guard` | Freeze and approval guards, pinned-asset delete guard | Triggers | `20261220000100_crm_estimates_quotations.sql` |
| `crm_quote_load_editable`, `crm_quote_touch`, `crm_quote_default_terms`, `crm_quote_minor_units`, `crm_quote_build_content`, `crm_quote_check_asset`, `crm_quote_content_hash`, `crm_quote_seed_company` (trigger `companies_quote_seed`) | Estimate helpers and seeding | The estimate functions and a trigger on `companies` | same |
| `crm_quote_save_header`, `crm_quote_save_section`, `crm_quote_delete_section`, `crm_quote_save_line`, `crm_quote_delete_line`, `crm_quote_reorder` | Per-part estimate writes | Only the estimate server actions (section 3.8) | same |
| `crm_save_terms_template` | Standard-terms template save; **no app caller exists** (removed from the editor) | Nothing | same |
| `crm_grant_access`, `crm_revoke_access` | Sales access grants | People & Access (not a Sales screen) | `20261115000000`, `20261215000000_access_grant_rules.sql` |
| `proj_notify`, `proj_lock_handover`, `proj_require_user`, `proj_next_reference`, `proj_user_eligible` | Projects helpers used inside the handover functions | The `proj_*` functions | `20261120000200_proj_projects_handover_functions.sql` |
| `inv_proj_after_insert`, `inv_import_handover_requirements` (trigger `inv_proj_projects_import`) | Draft equipment request created when a client project is inserted | Trigger on `proj_projects` | `20261201000400_inv_planning_functions.sql` |
| `runCrmReminders`, `generateRemindersThrottled`, `purgeExpiredUploads` and every use of `createAdminClient` | App-side service-role jobs | The cron route and the Follow-ups page | `apps/web/src/lib/crm/reminders.ts`, `upload-cleanup.ts` |

## 7. Projects-side actions triggered from this flow (not catalogued here)

After a handover is submitted, the next steps are Projects screens and functions: `proj_assign_handover_pm`, `proj_request_handover_clarification`, `proj_accept_handover` (creates the project; section 3 of [`sales-close-and-handover.md`](./sales-close-and-handover.md)), and everything in Projects, Inventory and Budget. They have their own owners and rules ([`../04-flows-sales-to-warehouse-and-others.md`](../04-flows-sales-to-warehouse-and-others.md) section 1.2). A Sales worker must not take them. A catalogue for those modules is not written yet.

**Accept handover is a separate Projects action, not part of Mark Won or Save and submit** (documented here only so the boundary is clear; it is not a Sales action and not catalogued as one): `acceptHandover` (`apps/web/src/lib/actions/projectsCore.ts:141`) -> `proj_accept_handover` (`20261120000200_proj_projects_handover_functions.sql:360`). Only the assigned Project Manager can accept; the handover must be `pm_assigned` and the Sales enquiry still Won. **The project is created on acceptance** (one `proj_projects` row with its details, the PM member, Sales links, handover set to `accepted` with `project_id`, notices `project_handover_accepted`): Mark Won creates only an empty brief, and Save and submit creates no project. A repeat click by the accepting PM returns the same project (idempotent); read the handover status first anyway. Stop and ask: yes (creates a project and notifies people); a Sales worker never takes it. Verify: the handover shows `accepted` with a project id and the project opens. Its permissions and side effects are `Unverified` beyond this read of the function (Projects-side, see the named gap "Projects-side handover steps" in [`sales-coverage-index.md`](./sales-coverage-index.md)).

## 8. Totals and gaps

* **63 actions** catalogued in section 3 (plus one enabled JARVIS action and six disabled ones in section 3.9, counted separately: they sit on top of the actions below) (enquiries, contacts and files 13; stage changes 6; follow-ups and reminders 7; proposals, availability, approval and Zoho 9; handover 4; settings and company 4; accounts, import and outreach 9; estimates 11). Plus 6 read-only action groups (section 5), the external-communication table (section 4) and the internal list (section 6).
* **Flagged stop-and-ask: 32** (24 unconditional, 8 conditional: `sales.enquiry.edit_details`, `.move_stage`, `sales.followup.complete`, `.reassign`, `sales.account.save_profile`, `sales.outreach.set_status`, `sales.estimate.delete_section`, `.delete_line`). Unconditional: `sales.enquiry.assign_owner`, `.mark_won`, `.mark_lost`, `.reopen`, `.remove_file`, `sales.contact.update_shared`, `sales.proposal.record_sent`, `.record_accepted`, `.supersede`, `sales.zoho.save_references`, `sales.availability.record_result`, `sales.approval.decide`, `sales.handover.save_and_submit`, `.withdraw`, `.update_legacy`, `sales.settings.save_company`, `.save_vat_choice`, `sales.company.save_issuer_details`, `.upload_logo`, `sales.account.assign_owner`, `sales.import.apply`, `sales.outreach.assign`, `sales.estimate.decide_approval`, `.finalise`.
* **Not safely retryable without reading first: 23** (was 24: `sales.zoho.save_references` moved out after the merge fix). Duplicate risk (15): `sales.enquiry.create`, `.add_activity`, `.contact_create_and_link`, `.add_link`, `.upload_file`, `sales.contact.create`, `sales.organisation.create_simple`, `sales.followup.create`, `.create_on_account`, `sales.proposal.add_version`, `sales.settings.save_vat_choice`, `sales.account.create`, `sales.outreach.log_activity`, `sales.estimate.create`, `.save_section` (without an id). Repeats a side effect or overwrites (8): `sales.estimate.finalise` (repeats the asset copying; the database itself refuses a second finalisation), `sales.proposal.record_sent`, `sales.availability.request`, `.record_result`, `sales.settings.save_company`, `sales.company.upload_logo`, `sales.contact.update_shared`, `sales.outreach.link_inquiry`. The other 40 are idempotent, refused on repeat, or protected by a version check (the strongest guards: `sales.import.apply` by batch key and advisory lock, `sales.enquiry.*` stage actions by the version check and by refusing a repeat).
* **Entries whose permission or starting state was not fully confirmed:** `sales.enquiry.add_link` (the Lost-enquiry refusal of `crm_register_file` was not read), `sales.company.save_issuer_details` (the exact write mechanism behind the System Administrator rule), `sales.estimate.finalise` (clean-up of pinned copies after a failed finalise), `sales.estimate.save_draft` (partial-failure behaviour), `sales.enquiry.upload_file` (the storage side needs a running stack). Hosted state of every action is `Unverified` (nothing was run against any hosted project).
