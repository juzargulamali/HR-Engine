# Recovery Leave and attendance — staff test cases (replacement / additional)

**Status of the old workbook:** the previous staff checklist (the 180-check Excel) was not available to me, and it describes the
*old* rules (same-calendar-day segments, the 4-hour rule, site-work-only overnight credit, midnight/8am resets). Its
Recovery Leave and attendance rows are obsolete once the new policy is live. **Updating the workbook itself is pending.**
Until then, use the cases below *instead of* those rows. Everything else in the workbook (Annual Leave, expenses, documents,
accounts, etc.) is unchanged by this release.

Test only with the dedicated test accounts. Do not approve or reject real people's requests. Use the controlled-time
tests (already automated in the database test suite) for exact second boundaries — live, you can only observe real time, so
the live cases below focus on what you can see and click.

How to read "Expect": it is what you should see in plain English. If you see something else, stop and report it.

## A. Clocking and the dashboard (employee)

| # | Do this | Expect |
|---|---|---|
| A1 | Open the dashboard before clocking in. | An "Attendance clock" card with a neutral **Not started** (or **Clocked out** if you already clocked today), and a **Clock In** button. No break buttons anywhere. |
| A2 | Clock in as **Office**. | The card shows a green dot and **Clocked in**, your mode, and the clock-in time in your own country's time. |
| A3 | Wait a minute. | "Last updated" moves; recorded hours in the current 24-hour window grow. The word "so far" appears. |
| A4 | Switch mode to **Work from home**, then **Client meeting**. | Still one session; the card shows the new mode. |
| A5 | On a phone, open the dashboard. | The card is readable, the status is text (not only colour), no sideways scrolling. |
| A6 | Clock out. | **Clocked out** (red dot + text). The day stays **Present** on the register. |
| A7 | Turn your phone's wifi off for a minute. | The page says **Disconnected** (not "Live"); when it returns it refreshes. |
| A8 | Sign in with an account that has no employee profile. | No attendance status card is shown (no fake "Clocked out"). |

## B. The HR register (HR Admin)

| # | Do this | Expect |
|---|---|---|
| B1 | Open **Attendance**. | An automatic table, not a form: Employee, Clock status, Attendance for the date, Work mode, First clock-in, Last clock-out, Recorded hours, Recovery/review, Edit. |
| B2 | Compare to who is actually clocked in. | Green **Clocked in**, red **Clocked out**, neutral **Not started** — each with its text. Nobody is shown as "Absent" or "Online/Offline". |
| B3 | Look at the tiles. | "Clocked in now" is separate from "Present on <date>". |
| B4 | Filter by Clocked in, Office, Work from home, Site work, Client meeting, On leave, Needs review. | Only matching people. Someone who used two modes appears under both. |
| B5 | Pick yesterday, then a future date. | Yesterday shows what happened; a future date shows nobody as clocked in. |
| B6 | Open a row (click the name). | Sessions, modes, projects, leads, location notes, corrections. |
| B7 | A person is still clocked in. | Their hours say "so far — still clocked in" and there is no "short day" message. |
| B8 | Click **Edit** on a row; try to save a change with no reason. | The Save button stays disabled until a reason is typed. |
| B9 | Edit → **Add missing attendance** for an employee who forgot to clock a short shift. | A new session labelled **Recorded by HR**; it never shows as Clocked in. |
| B10 | Correct that session's end time (with a reason). | The row shows the new hours; the expanded view shows "Corrected by HR" with the original and corrected times, who, when and why. |
| B11 | Try a clock-out in the future, or times that overlap another recording. | Refused with a clear message; nothing changes. |
| B12 | Open the old manual tool link under the table. | The previous all-row form still opens, with a note that typed totals never create Recovery Leave by themselves. |

## C. Recovery Leave amounts (these need real elapsed time or HR-entered evidence)

Use **Add missing attendance** with exact times on a test account to create evidence quickly. A shift's window is judged by
the local date it **starts** on in the employee's own country (Saudi Arabia: Sunday–Thursday working week; UAE and Poland:
Monday–Friday).

| # | Evidence | Expect for the window |
|---|---|---|
| C1 | Normal working day, 9 hours. | Nothing (9 hours is the normal day; no deduction either). |
| C2 | Normal working day, exactly 13h 00m 00s. | Nothing. |
| C3 | Normal working day, 13h 00m 01s. | 0.5 day. |
| C4 | Normal working day, exactly 17h 00m 00s. | 0.5 day. |
| C5 | Normal working day, 17h 00m 01s. | 1 day (never more than 1 per window). |
| C6 | Weekly rest day, 1h 59m 59s. | Nothing. |
| C7 | Weekly rest day, exactly 2h. | 0.5 day. |
| C8 | Weekly rest day, exactly 6h. | 0.5 day. |
| C9 | Weekly rest day, 6h 00m 01s. | 1 day. |
| C10 | A public holiday that falls on a weekend. | One benefit, not two. |
| C11 | Saudi employee, Friday 14 hours vs a UAE employee, Friday 14 hours. | Saudi: rest-day band (1 day). UAE: normal day (0.5 day). |
| C12 | A shift starting Thursday evening in Saudi Arabia and running through Friday. | Classified by the Thursday start only. |
| C13 | Office, WFH, Site work and Client meeting on a rest day (separate tests). | All qualify equally. |
| C14 | Business travel. | Recorded, but flagged for HR verification before any credit. |
| C15 | 14 hours, a 2-hour clocked-out gap, then 4 hours. | One working period, 18 recorded hours in one window = 1 day, no alert. |
| C16 | Two shifts with a gap of 7h 59m 59s vs exactly 8h. | 7h 59m 59s = one period; 8h = a new period. |
| C17 | Someone left clocked in for more than 24 hours. | The window rolls over by itself with no clock-out; each 24 elapsed hours is judged separately; the dashboard says it rolled over. |
| C18 | Recorded work reaches 20 hours with no 8-hour rest. | One amber notice for the employee and one HR alert (once only). Recording continues. |
| C19 | **Activation day:** an employee's last shift under the old rules ends 20:00; they clock in again at 02:00 on the day the new policy starts (6 hours later). | Still judged by the old rules (no new-rules period is created, nothing is awarded twice). A restart exactly 8 hours later starts the new rules. |
| C20 | **Switch-off day:** a shift running under the new rules ends 23:30 on the last day it applies; the employee clocks in again at 02:00 the next day (2.5 hours later). | One working period under the new rules: the hours of both parts add up in ONE window and earn ONE award. A restart 8 hours or more later is judged by whatever rules are in force then. |

## D. Approvals

| # | Do this | Expect |
|---|---|---|
| D1 | A window with credit closes. | A request appears for the right approver: ordinary employee + lead → lead then HR; self-led → HR; permanent manager → HR; HR employee → shared CEO/CTO queue (never themselves). |
| D2 | Open the request. | Exact hours to the second, the window, the starting date and rule, the policy version, original vs corrected evidence, review conditions, the route. |
| D3 | Try to approve a window that still needs HR verification. | Approve is disabled and says why; after HR verifies (with a note) it works. |
| D4 | A request with no project lead. | Shown as awaiting a lead; the employee or HR supplies one; it is never lost. |
| D5 | Correct the evidence of a **pending** request from 0.5 to 1 day. | The same request now says 1 day; an already-approving lead must approve again. |
| D6 | Correct an **approved** 0.5 credit up to 1 day. | A new request for **only +0.5**; after approval the total is 1. Re-running never adds more. |
| D7 | Correct an approved credit **down**, after some of it was used. | HR must acknowledge explicitly; the balance is never silently negative. |
| D8 | Check expiry on a topped-up credit. | Same expiry as the original (180 days from the window's date). |

## E. Alerts and background processing (HR Admin)

| # | Do this | Expect |
|---|---|---|
| E1 | Open **Alerts**. | A banner shows the last successful background run and whether the 5-minute scheduler is enabled. |
| E2 | Look at a long-work alert. | Employee, company, original period start, recorded vs elapsed hours, trigger time, rest info, Acknowledge. |
| E3 | Acknowledge it (with a note). | It leaves the open list; it is not raised again. |
| E4 | Sign in as a plain employee or manager. | The alerts page is refused. |
| E5 | Read the processor panel before the owner has enabled the 5-minute scheduler. | It says "5-minute processor: not verified" and why (for example pg_cron not installed, job missing, no recent successful run). |
| E6 | Read the "Database fingerprint" on that panel and compare it with check 2.0 of the verification SQL in the Supabase project *Enginious HR Engine_V2*. | The same 8 characters. If not, stop: the app is connected to a different database. |
| E7 | After a policy has been switched off, look at "Work still being finished". | It still counts running periods; the scheduler stays enabled until every number is 0. |

## F. Policies (HR Admin; the CEO/CTO may activate or switch off, never edit)

| # | Do this | Expect |
|---|---|---|
| F1 | Press "Create Recovery Leave (windows) drafts". | Drafts for UAE, Saudi Arabia, Poland; the active version is unchanged; nothing is active. |
| F2 | Open a draft. | A rules table and wording generated from it (no hand-typed contradictions). |
| F3 | Try to activate as the person who drafted it. | Refused. |
| F4 | A second HR Admin (a grant limited to that country is enough) activates with tomorrow's date — **after** the scheduler line on the draft says "verified running". | The old version ends the day before; clock-ins from that date use the new rules; a session already open before then finishes the old way. |
| F5 | Try an effective date of today or earlier. | Refused. |
| F6 | Try to activate while the 5-minute processor is not verified. | Refused with the reason; nothing changes. |
| F7 | As the CEO or CTO, open a draft whose date HR has saved. | You see the date HR set and can activate on exactly that date; you cannot choose or change it. |
| F8 | As an HR Admin or the CEO/CTO, switch the new rules off from a future date. | Nothing is deleted; running periods finish under the rules they started with; the scheduler keeps running (see E7). |

Report anything that does not match, with the time, the employee (test account) and a screenshot.
