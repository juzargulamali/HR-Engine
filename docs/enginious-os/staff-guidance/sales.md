# Staff guidance: Sales & CRM

Approved, staff-facing guidance. JARVIS answers "how do I" questions from the topics below that are marked `published` (see [README](./README.md)).

## How Sales & CRM works
- id: sales-overview
- area: sales
- status: published
- keywords: sales crm; sales and crm; how does sales work; how sales works; sales module; sales process; sales overview; explain sales; what is sales; sales workflow; enquiry process; enquiry to handover; how does the crm work
- links: Enquiries -> /sales/opportunities; Follow-ups -> /sales/follow-ups; Clients & Agencies -> /sales/accounts; Reports -> /sales/reports
- screens: /sales

Sales & CRM follows each enquiry from the first message to the handover. An enquiry moves through the stages New enquiry, Qualified, Proposal preparation, Proposal sent, Quote sent and Negotiation, and ends as Won or Lost. Sending an estimate is recorded on the enquiry and is not a stage. Every open enquiry keeps one next action, so Follow-ups always shows what to do next. A won enquiry is handed over to the project team; winning it does not by itself mean the project was delivered.

1. Add the enquiry in Enquiries (title, source, agency or end client, and the next action with its date).
2. Work it from Follow-ups: log each call, email or meeting on the enquiry and plan the next step.
3. Move it to the next stage as it progresses. Proposal sent needs a proposal recorded as sent; Quote sent needs the Zoho Books quote reference. An estimate recorded as sent counts for neither.
4. Build the estimate from the enquiry when a price is needed. Prices stay in the Estimate screen. After you send it to the client, record it as sent on the Estimates tab. That records the revision and the date; the stage stays where it is.
5. Mark it Won or Lost from the enquiry page, then complete the handover for a won enquiry. Reports shows the pipeline and results for your company.

## See your overdue follow-ups
- id: sales-overdue-follow-ups
- area: sales
- status: published
- keywords: overdue follow-ups; overdue follow ups; overdue followups; my overdue; late follow-ups; what is overdue; overdue actions
- links: Follow-ups -> /sales/follow-ups
- screens: /sales/follow-ups

A follow-up is overdue once its due time has passed and it is still open. The Follow-ups page counts them on the Overdue card and lists them first. Due times are on the clock of the company the follow-up belongs to, with the place written after the time. In JARVIS you can also type "Show my overdue Sales follow-ups" to list your own for the selected company, or "What needs my attention today?" for everything.

1. Open Follow-ups in Sales and press the Overdue card to see only what is overdue. Show all to-do brings the whole list back.
2. Do the work, then press Complete on the row to record what happened and plan the next action.
3. If it only needs a new date, press Reschedule and choose Tomorrow, In 2 days, Next week or your own date. The new due date is shown before you save.

## Ask JARVIS about your follow-ups and enquiries
- id: sales-jarvis-lookups
- area: sales
- status: published
- keywords: what needs my attention; attention today; my priorities; follow-ups due today; upcoming follow-ups; my open enquiries; open enquiries for a client; enquiries with no activity; quiet enquiries; status of an enquiry; ask jarvis about enquiries
- links: Follow-ups -> /sales/follow-ups; Enquiries -> /sales/opportunities

In JARVIS you can ask about your Sales work for the selected company: what needs your attention today, follow-ups due today or coming up, your open enquiries (or everyone's), open enquiries for a client, agency or event, enquiries with no recorded activity, and the status of one enquiry. The answer shows whose records, the filters, the time and the exact total. It stays inside Enginious OS and never shows values or budgets.

1. Open JARVIS and choose the company at the top of the panel.
2. Type the question, for example "What needs my attention today?" or "Open enquiries for" and the client's name.
3. Refine it in a few words: "the whole company instead", "only Negotiation", "make it 30 days".
4. Open a record from its link to act on it.

## Ask JARVIS for a Sales summary
- id: sales-jarvis-summaries
- area: sales
- status: published
- keywords: summarise enquiries; summary of this month; how many enquiries; how many did we win; won and lost; win rate; which events have the most enquiries; compare with last month; what changed; summarise this enquiry; next steps for an enquiry; trends
- links: Reports -> /sales/reports; Enquiries -> /sales/opportunities

JARVIS counts enquiries for a period inside Enginious OS: created, won, lost, share won, by event, by source and recorded lost reasons. Counts only, no values. Explain & suggest sends the company, the period, the counts and the breakdown labels (lost reasons included) to Anthropic: Enginious OS writes the factual sentences and Anthropic adds suggestions. For one enquiry, the AI model summarises its notes; check it against the record. A won enquiry is not a delivered project.

1. Ask, for example, "How many enquiries did we win or lose last month?" or "Summarise this month's enquiries".
2. Change it in a few words ("show last month instead") or press Compare periods.
3. Press Explain & suggest, or ask it to "summarise", only if you want suggestions from Anthropic; a plain count stays inside Enginious OS.
4. For one enquiry, ask "Summarise" with its reference to get its facts and suggested next steps.
5. Open Reports for values and the full report.

## Draft the scope wording for an estimate with JARVIS
- id: sales-jarvis-scope-draft
- area: sales
- status: published
- keywords: estimate scope; scope of work; draft estimate lines; line descriptions; estimate wording; deliverables for an estimate; quotation scope; help with an estimate
- links: Proposals & quotes -> /sales/proposals; Enquiries -> /sales/opportunities

JARVIS can draft the scope wording for an estimate: line descriptions, quantities, what the client supplies, dependencies, exclusions and questions to ask. It is a draft to copy. It has no prices, reads no saved estimate or price, and does not create, approve or send an estimate: you enter amounts in the Estimate screen.

1. Ask "Draft the estimate scope for" and the enquiry's reference, or paste the requirements.
2. Check the draft and the questions, then press Copy.
3. Open the enquiry's estimate and paste the lines you want.
4. Enter quantities and prices there and finish the estimate as usual.

## Add an enquiry
- id: sales-add-enquiry
- area: sales
- status: published
- keywords: add enquiry; new enquiry; create enquiry; add an enquiry; create an enquiry; log an enquiry; new inquiry; add inquiry; create inquiry; quick add; enter a lead; new lead; event not listed; create event or edition; add a missing event
- links: Enquiries -> /sales/opportunities; Full new-enquiry form -> /sales/new
- screens: /sales/opportunities; /sales/new

Enquiries live in Sales. The quick form needs the company, What is the enquiry?, where it came from, an agency or an end client (or both) and the next action with its date. It starts in the company you are working in; if you have several and none can be assumed, choose one first. The line Saving to shows the company and currency before you save. If a save seems to hang, press it again: the same form never makes a second enquiry, it opens the one already saved and says so.

1. Open Enquiries in Sales.
2. Press Add enquiry and check the company.
3. Fill in What is the enquiry?, the source, the agency and/or end client, and what happens next and when. Open the full form keeps what you typed.
4. If the enquiry is for a show, choose it in Event / Exhibition: the event start and end are filled from that edition and you can still change them. Dates you typed first are kept. If the show or its edition is not listed, press Create event or edition under the field; what you have typed stays as it is.
5. Save. You return to the list you started from with the new enquiry open beside it; the full form opens the enquiry's own page.

## See and plan follow-ups
- id: sales-follow-ups
- area: sales
- status: published
- keywords: follow-up; follow up; followup; next action; to-do; todo; reminder; overdue; due today; schedule next action; add follow-up; add a follow-up; log a follow-up; dismiss handover accepted; handover accepted notice; remove handover accepted
- links: Follow-ups -> /sales/follow-ups; Enquiries -> /sales/opportunities
- screens: /sales/follow-ups

The Follow-ups page lists what you need to do next. The Overdue, Today and Upcoming cards narrow the list when pressed. Every enquiry still being worked needs one open next action, so the only one cannot be cancelled: complete it with a new one, or put the enquiry on hold. Dismiss clears a reminder. Times are on the clock of the follow-up's company (Dubai, Riyadh or Warsaw), with the place after them,. Today is that company's day. Older deadlines keep their moment: 10:00 Dubai reads 07:00 (Warsaw) in winter.

1. Open Follow-ups in Sales. Press a card to see one group, or Everyone to see the team's.
2. Press Complete to record what happened and plan the next action, or Reschedule to move the due time.
3. To add one, open the enquiry and use Add follow-up, then choose what to do, the date and who it is for.
4. A Handover accepted line is news only: Dismiss takes it off your own list and My Day. A line under Questions from Operations opens the question on the enquiry; it goes when you answer.
5. Still on Dubai time for every company: the reminder for a hold's review date, the daily reminder for an enquiry with no next action, the dates in Sales reports, and anything JARVIS saves or lists.

## Log a call, email or meeting on an enquiry
- id: sales-log-update
- area: sales
- status: published
- keywords: log a call; log call; log an email; log a meeting; add update; add an update; log activity button; main button on an enquiry; more menu; activity; record a call; note on an enquiry; meeting notes; add a note; timeline; log activity; history; comments; comment history; what happened; first response; pick up an enquiry; where does it stand
- links: Enquiries -> /sales/opportunities
- screens: /sales/opportunities/[id]

Activities are the enquiry's diary. Log one after a call, an email or a meeting; you can plan the next step in the same box. The first call, email or meeting you log is recorded as the first response. Logging only records it: nothing is sent to the client. To pick up someone else's enquiry, read the summary at the top: the next action, the one main button, what is in the way, and where it stands.

1. Open the enquiry.
2. Press Log activity at the top.
3. Choose the kind (call, email, meeting, note or client response) and write what happened. If it was one of the planned follow-ups, choose it and your words become its outcome.
4. Turn on Plan the next step if you want a follow-up created at the same time.
5. To read what happened, open Activity & history. All shows everything; People's updates shows what people wrote; System shows what the app recorded. A completed follow-up appears once.

## Edit an enquiry's details
- id: sales-edit-details
- area: sales
- status: published
- keywords: edit enquiry; edit an enquiry; change enquiry; edit details; change the title; change the location; change the dates; update enquiry; amend enquiry; change the event date
- links: Enquiries -> /sales/opportunities
- screens: /sales/opportunities/[id]

The enquiry's owner, or a Sales founder, can edit its details while it is open. Once it is Won only a founder can change the value, and a Lost enquiry cannot be edited.

1. Open the enquiry.
2. Open More at the top and choose Edit details, or use Edit details on the Scope & dates tab.
3. Change what you need and save. If someone else changed it first you will be asked to reload. Changing the dates, technologies or quantities means the equipment availability check must be repeated. A recorded check reads Availability checked, stock not reserved, with the warehouse and the dates it covered.
4. Choosing a different Event / Exhibition fills a show date that is empty; a date already on the enquiry is kept, and Use edition dates replaces it if you want. A date you empty on purpose stays empty. Create event or edition is under that field here too.

## Change an enquiry's stage
- id: sales-move-stage
- area: sales
- status: published
- keywords: change stage; move stage; change status; move to; stage; status of an enquiry; pipeline; board; qualified; negotiation; proposal sent; estimate sent; quote sent; on hold; put on hold; resume
- links: Enquiries -> /sales/opportunities; Board view -> /sales/opportunities?view=board
- screens: /sales/opportunities/[id]; /sales/pipeline

The enquiry's owner or a Sales founder moves it: one step back, or any step forward. Proposal sent needs a proposal recorded as sent, and Quote sent needs the Zoho Books quote reference. Estimate sent is no longer a stage: record an estimate as sent on the Estimates tab, and the stage stays where it is. If an enquiry still shows "Estimate sent (stage no longer used)", its owner or a founder chooses its stage with Move stage. Won, Lost and On hold have their own forms.

1. Open the enquiry (or use the Board view of Enquiries).
2. Open More at the top, choose Move to another stage and pick the stage. Put on hold, Resume and Reopen are in the same menu.
3. If the stage needs something first, the screen says what. On the Board the card stays where it was and shows a link to the tab where you record it.

## Mark an enquiry won or lost, and hand it over
- id: sales-close-handover
- area: sales
- status: published
- keywords: mark won; mark as won; won; lost; mark lost; close an enquiry; close enquiry; handover; hand over; hand-over; reopen; re-open; track a handover; handover status; project created; open project; pm asked a question
- links: Enquiries -> /sales/opportunities
- screens: /sales/opportunities/[id]

Won and Lost are closed on their own form, which asks for the evidence or the reason. After Won, the top of the enquiry shows where the delivery handover stands and who has it next. The handover page says Ready for handover or Not ready, what the project will receive and what is not copied. The project receives the agency (or that the job is direct), the site contact you choose and your notes. Prices, files and other contacts stay in Sales. JARVIS does not close, reopen or hand over enquiries.

1. Open the enquiry.
2. Open More at the top, choose Close as won or Close as lost, and fill in the form.
3. After Won, press the main button to prepare the handover. Write the scope of work: the brief cannot be submitted without it. Check the agency, and choose the Site contact from the enquiry's contacts (add the person under Contacts first if needed).
4. Submit it, or answer the Project Manager's question and resubmit. When the project exists, Open project takes you to it if you have access.
5. The chip My won: handover open on the Enquiries list finds your won enquiries whose handover is not accepted yet.

## Find or add a client or agency
- id: sales-clients-agencies
- area: sales
- status: published
- keywords: add a client; add client; new client; add an agency; add agency; new agency; register; client or agency; clients and agencies; organisation; organization; account; duplicate client; import clients; excel import
- links: Clients & Agencies -> /sales/accounts; Import from Excel -> /sales/accounts/import
- screens: /sales/accounts; /sales/accounts/import; /sales/clients

Clients & Agencies holds every organisation. Search first so you do not add the same one twice. An organisation can be an agency, a direct client, an end client or a technology company, and an enquiry's agency and end-client boxes offer only organisations with the matching role.

1. Open Clients & Agencies and check the company named above the list: owners and enquiry figures are shown for that company. Search by name; More filters holds country, lead source and exhibition.
2. The list shows 100 accounts a page; use Next page for more.
3. If it is not there, press Add account and give its roles (and country and website if you know them).
4. To add many at once, open Import and export and choose Import from Excel. The preview says what will be created, updated and skipped before you confirm.

## Build an estimate
- id: sales-estimates
- area: sales
- status: published
- keywords: estimate; estimates; quotation; quote; boq; price an enquiry; pricing; vat; revision; pdf of the estimate; excel of the estimate; record estimate as sent; estimate sent; sent the estimate
- links: Enquiries -> /sales/opportunities
- screens: /sales/proposals

Estimates are built on the enquiry's Estimates tab in three steps: details, items, then preview and finalise. An estimate is budgetary; official quotations go through the Zoho Books workflow. Finalising or downloading an estimate does not send it and does not record it as sent: you send it yourself, then record that here.

1. Open the enquiry and go to the Estimates tab.
2. Create an estimate and fill in the details and the items.
3. Preview, then finalise. A finalised estimate is frozen; make a revision to change it.
4. After you have sent it to the client, press Record estimate as sent on that revision and confirm the date it went out. The row then shows the sent date, when it was recorded and by whom. The enquiry's stage does not change.
5. A revision of a quotation issued before estimates replaced quotations shows the terms it carried over. Read them, then press Replace with the current estimate format and confirm. Until you do, that draft cannot be finalised or sent for approval; if you try, you are told to replace the terms carried over into the draft first. The earlier revision and its files stay as issued.

## Events & Exhibitions
- id: sales-events
- area: sales
- status: published
- keywords: events and exhibitions; exhibitions; trade shows; trade fair; expo; upcoming shows; event calendar; calendar view; month view; add an event; add an edition; first edition; which shows are coming; conference
- links: Events & Exhibitions -> /sales/events; Import events -> /sales/events/import
- screens: /sales/events

Events & Exhibitions is the shared calendar of shows, one row per edition, with how many enquiries are linked to each. It opens on upcoming editions; you can filter by name, country and dates, or switch to past editions. Everyone in Sales sees the same calendar; the enquiry figures count only the enquiries you can see. It helps you see which shows are coming up, how much business each one has brought, and which to prepare for.

1. Open Events & Exhibitions in Sales.
2. Search or choose a filter to find a show: the list changes as soon as you choose, and Clear removes the filters. Open a show to see its editions, who exhibited and the agencies to contact.
3. Press Add event for a show that is not listed. One form takes the name, the type and the first edition's dates and place, and one save adds both. If the name already exists, the form shows that event and offers to add the edition to it instead.
4. Press Add edition for the next year of a show that is already listed.
5. Switch from List to Calendar to see the shows by month (Previous, Next and Today move between months; a show's name is on each of its days and opens that edition). To add many shows at once, use Import events with the template.

## Work one event: who exhibited, agencies to contact, observations
- id: sales-event-page
- area: sales
- status: published
- keywords: record an observation; who exhibited; which agency built the stand; agencies to contact; exhibitor history; stand builder; event page; add first edition; add next edition; archive an event; outreach priority
- links: Events & Exhibitions -> /sales/events; Clients & Agencies -> /sales/accounts
- screens: /sales/events/[id]

An event page shows the same show across its editions: who exhibited each year and with which agency, the agencies worth contacting for the next edition (highest outreach priority first), and the enquiries linked to it. At the show you can record what you see on your phone without creating an enquiry.

1. Press Record an observation, choose the edition and the exhibitor, then the agency (or Agency unknown).
2. Read Who exhibited, and with which agency to compare the years.
3. Under Agencies to contact, set the outreach priority and open the account to start outreach or a follow-up.
4. Press Add first edition on an event that has none yet, or Add next edition when the next dates are known: it starts with the last place and you enter the dates. Edit and Archive are under More; archiving keeps the history and deletes nothing.

## Import events from a spreadsheet
- id: sales-events-import
- area: sales
- status: published
- keywords: import events; upload events; bulk add events; events spreadsheet; events template; excel events; csv events
- links: Import events -> /sales/events/import; Events & Exhibitions -> /sales/events
- screens: /sales/events/import

Import events adds many shows and editions to the shared calendar from one file. Each row is one edition and needs the event name, country, start date and end date. Nothing is saved until you confirm the preview.

1. Download the template and fill one row per edition (dates as YYYY-MM-DD).
2. Upload the file and read the preview: each row is marked new, adds an edition, already present or needs correction.
3. Correct any row that needs it and upload again.
4. Press Confirm. All rows are saved together or none.

## Outreach: accounts assigned to you to approach
- id: sales-outreach
- area: sales
- status: published
- keywords: outreach; my outreach; prospects; prospecting; accounts to approach; assigned accounts; log outreach; cold approach; re-engage a client; assign outreach
- links: Outreach -> /sales/outreach; Clients & Agencies -> /sales/accounts
- screens: /sales/outreach

Outreach is your list of accounts to approach before any enquiry exists. Each row shows the account, its contact, the owner, the next action with its due date, and where it stands in words: overdue, due today, waiting for reply or enquiry raised. Logging an activity only records it; nothing is sent to the client. It never creates an enquiry by itself.

1. Open Outreach in Sales and check the company named above the list.
2. Press the button on a row: Log activity after a call, email or meeting, or Set next action when nothing is planned.
3. Choose a status or tick Overdue only to decide what to do first.
4. On the account, choose the Contact for this outreach. When the client is ready, press Create enquiry: the form opens with the account, that contact, the source Outreach and your notes; check it and save. One outreach raises one enquiry: a second try opens the first.
5. Accounts are assigned from Clients & Agencies by the people who manage Sales assignments.

## Sales reports
- id: sales-reports
- area: sales
- status: published
- keywords: report; reports; sales report; enquiries by source; pipeline value; kpi; response time; statistics
- links: Sales reports -> /sales/reports
- screens: /sales/reports

Sales reports are read-only figures in two groups. Current pipeline and follow-ups is as of now and does not change with the dates. Results for the selected period counts only what was logged or closed between the dates. Under each title a line says how many records, which company and which period the figure rests on. If a card cannot be loaded it says so instead of showing zero.

1. Open Reports in Sales.
2. Choose the company above the report (or All my companies), then the period.
3. Press the i beside a title for its definition. A number that is a link opens exactly those enquiries.

## Sales settings
- id: sales-settings
- area: sales
- status: published
- keywords: sales settings; reference code; response target; working calendar; duplicate window; approval policy; vat choices; settings
- links: Sales settings -> /sales/settings
- screens: /sales/settings

Sales settings are shown for one company at a time: Response targets, Commercial approval, Estimates & VAT with the VAT choices, and the Follow-up time zone, the clock that company's follow-up times are typed and shown on. Anything that stops work is listed first, for example a missing reference code and currency, which stops enquiries being recorded. Founders and people who manage Sales settings can change them; others can read them.

1. Open Settings in Sales (under Manage in the menu) and choose the company above the page.
2. Follow a link in the list at the top to the setting that needs filling in.
3. Change a part and press its save button. Parts with changes say Changes not saved yet, and the page asks before you leave with unsaved changes.
4. To change the Follow-up time zone, choose the zone by name and press Save time zone. No existing follow-up moves: each keeps its exact moment and is then shown on the new clock, so tell the team first.
5. The UAE company uses Dubai time, the Saudi company Riyadh time and the Polish company Warsaw time. Hold review reminders, the no next action reminder, report dates and JARVIS stay on Dubai time for every company.

## Flag an enquiry for Operations planning
- id: sales-operations-planning
- area: sales
- status: published
- keywords: flag for operations planning; operations planning; tentative dates; dates are tentative; tell operations about a job; provisional project manager; question from operations; answer operations; remove from operations planning; dismantling date
- links: Enquiries -> /sales/opportunities
- screens: /sales/opportunities/[id]

The owner of an enquiry, or a Sales founder, can flag it so Operations can plan early. Operations then sees its dates, place, technologies, event and your planning notes, never prices, quotes or Sales notes. Tentative means the client has not confirmed the dates; once the enquiry is won it reads as confirmed. Nothing is booked, and a provisional Project Manager named by Operations is only a note. When Operations asks a question, the enquiry's owner gets one notice on Follow-ups and My Day that opens the question.

1. Open the enquiry. On Overview find Operations planning and press Flag for Operations planning.
2. Fill Expected decision date, Dismantling date, Expected teams, Still to confirm and Note for Operations. Leave Dates are tentative ticked until the client confirms.
3. Press Flag for Operations planning. Use Edit planning details to change it later.
4. Read From Operations. If there is a question, write Your answer and press Send answer to Operations.
5. Remove from Operations planning hides the enquiry from Operations again.

## The company you are working in, in Sales
- id: sales-company
- area: sales
- status: published
- keywords: which company; wrong company; change company in sales; choose a company; all my companies; company bar; sales company; switch company; why this company
- links: Enquiries -> /sales/opportunities; Reports -> /sales/reports
- screens: /sales/reports

Sales pages and the Add enquiry forms work in one company, named above each page. It is the company of what you have open, else the one you used last in Sales, else the company you are employed by. If you have several and none of these applies, the page asks you to choose and shows nothing until you do. Follow-ups, Enquiries, Events and Reports can also show All my companies.

1. Look at Company above the list. Press the i beside it to see why that company is shown.
2. Press another company to change it. The next Sales page and Add enquiry open in the company you chose.
3. If the page says Choose a company, press one to see its records.

## Add a proposal version
- id: sales-proposal-version
- area: sales
- status: published
- keywords: add proposal; proposal version; upload a proposal; proposal document; record proposal as sent; proposal accepted; proposals and quotes; proposal register; new version of a proposal
- links: Proposals & quotes -> /sales/proposals; Enquiries -> /sales/opportunities
- screens: /sales/proposals

A proposal is made outside Enginious OS and kept on the enquiry as a file or link, one version at a time. The owner of the enquiry or a Sales founder adds versions. Sent is a date you record after sending it yourself; it is not an approval, and Accepted is not a win. Proposals & quotes lists every version across enquiries with its next action.

1. Open the enquiry and go to Proposals & files.
2. Under Add version, write what changed and choose Upload a new file, Use a file already added or No document yet.
3. Press Add version as a draft. If the file went up but the version did not, press Retry: the file is not uploaded again.
4. After you send it to the client, press Record as sent on that version; record it as accepted when the client accepts it.
