# MSU Sheep Genotyping

The producer genotyping service run by the MSU Sheep Program: producers submit samples online, follow them on a private page and download their results; staff receive boxes, build batches for GenomNZ and send invoices.

| Part | Where it lives | What it does |
|---|---|---|
| Website | This repo, served by GitHub Pages at https://cjposbergh.github.io/MSUSheepGenotyping/ | Submission page, private status/results page, sign, replacement and packing-slip pages, and the two staff pages |
| Tracker | A Google Sheet owned by cposbergh@gmail.com | Every producer, submission, animal, batch, result, invoice and email |
| Back end | Apps Script bound to the tracker (`apps-script/`) | Answers the website, sends email, makes invoice PDFs, adds the **Genotyping** menu |
| Results files | R (`r/`) on your computer | Pushes genotype calls and parentage to the tracker, makes each producer's PDF and Excel results |
| Drive | "MSU Sheep Genotyping" folder in the same account | Uploaded forms, photos, invoices, results files, GenomNZ batch files |

Staff who only receive boxes and build batches need [docs/STAFF_GUIDE.md](docs/STAFF_GUIDE.md), not this file. They never need access to the Sheet.

**Contents:** [How a submission flows](#how-a-submission-flows) · [First-time setup](#first-time-setup) · [Day-to-day admin](#day-to-day-admin) · [Cost-share](#cost-share) · [Invoices and partner bills](#invoices-and-partner-bills) · [Results in R](#results-in-r-pdf-and-excel) · [Editing wording](#editing-wording-emails-pages-pdfs) · [Privacy, photos, NSIP](#privacy-photos-research-withdrawal-and-nsip) · [Changing the code](#changing-the-code-and-testing) · [Troubleshooting](#troubleshooting)

---

## How a submission flows

1. **Submit** (`index.html`). The producer downloads the blank Excel form, fills it in and uploads it. The page checks it in the browser (TSU and EID formats, birth years, duplicates, the EXAMPLE row) and will not submit until it is signed: either online (research question, the six terms, "I agree", typed name) or by choosing the paper consent form. Photos are optional and only possible when signing online with research use = Yes. The tracker gets a Producer (matched by email; an existing producer's record is never changed from the public form: the form's contact details go in `Contact_On_Form` and any difference is flagged in `Staff_Notes` for you to check), a Submission and one Animals row per animal; the form is saved in the submission's Drive folder. Email **E01** (online) or **E02** (paper) goes out with the private link and packing-slip link.
2. **Packing slip** (`slip.html?t=…`). Printable, one page for up to 44 TSUs, with a QR code of the reference.
3. **Receiving** (`staff/receive.html`). Staff scan the slip QR (or type the reference, or scan any TSU), scan each TSU, tick the paper consent form if it is in the box, and finish. That marks animals Received / Not received, sets the submission to **Received** or **On hold** (not signed), drafts the invoice (**Ready for review**), and shows the receipt email **E05** for staff to edit and send.
4. **Signing later** (`sign.html?t=…`). A paper signer whose box came without the form can sign online; the hold lifts (**E04**). Daily reminders (**E03**) go out automatically: first after `Reminder_First_Days`, then every `Reminder_Every_Days`, at most `Reminder_Max`.
5. **Batch** (`staff/batches.html`). Received, signed samples are listed by submission. Creating a batch fills GenomNZ's Animal Info template in the browser (Birth Flock, Birth Tag = Animal_Key, YOB, Breed, Sex, TSU), downloads it and saves a copy to Drive/Batches. **Mark as shipped** sets samples to At lab and emails producers (**E07**).
6. **Results** (R, then the Genotyping menu). `push_results()` and `push_parentage()` write calls to the tracker (not yet visible to producers), `results_reports()` makes the PDF and Excel files and links them, then **Genotyping > Release results** publishes them on the producer's page and sends **E08**.
7. **Replacements** (`replace.html?t=…`). Failed or missing samples show on the producer's page with a link to register replacement TSUs (new TSU, or the original if it turns up). They get a replacement slip (`slip.html?t=…&r=P003-01-R1`) and **E09**. Staff receive them like any box (the replacement reference or the new TSU opens it; **E10**); they then show up in Batches for the next run. Replacements for failed QC are free; a late original goes on its own invoice if the first one was already sent.

Submission statuses: Submitted → Received (or On hold) → At lab → Analyzing (set by R) → Results released.

---

## First-time setup

Do these once, in this order. Everything runs as **cposbergh@gmail.com**.

### 1. The tracker Sheet
1. In Google Drive (as cposbergh@gmail.com) upload `tracker/MSU_Sheep_Genotyping_Tracker_START.xlsx`, open it, then **File > Save as Google Sheets**. Use the Google Sheets copy from now on and delete the uploaded .xlsx. (`…_EXAMPLE.xlsx` is the same tracker filled with made-up data, for looking around.)
2. On the **Settings** tab check every value. In particular:
   - `Staff_Passphrase`: type the staff passphrase here, and only here. The copies of the tracker in this public repo leave it blank on purpose; the staff pages stay locked while it is blank.
   - `Blank_Submission_Form` and `Paper_Consent_Form`: Drive links. Set both files to **Share > Anyone with the link > Viewer**, or producers can't open them.
   - `Site_URL`: the GitHub Pages address, ending in `/`. Every link in every email starts with it.
   - `Mailing_Address`, `Dropoff_Location`, `Dropoff_Hours`, `Contact_Email`, `Contact_Phone`, `Checks_Payable_To`: shown on pages, slips, invoices and emails.
   - Leave the `…_Folder_ID`, `…_Template_ID` rows blank: Set up fills them.
3. Check **Cost_Share** (CS01 = ASI Fine Wool genotyping, Erika Sanko, esanko@sheepusa.org, through Dec 2027; GR01 is a placeholder for your grant funder), **Services** (GENO $18, TSU $2.75) and **Conditions** / **Result_Key** (what the tests are and how each call is labelled).

### 2. The Apps Script back end
1. In the Sheet: **Extensions > Apps Script**. Name the project "MSU Sheep Genotyping".
2. **Project Settings (gear) > Show "appsscript.json" manifest file in editor**, then replace its contents with `apps-script/appsscript.json`.
3. For every other file in `apps-script/`, add a file with the same name (**+ > Script** for `.gs`, **+ > HTML** for `Review.html`; the editor adds the extension) and paste the contents in. There are 14 `.gs` files plus `Review.html`. Delete the empty `Code.gs`.
   Faster alternative if you are comfortable with a terminal: install [clasp](https://github.com/google/clasp) (`npm i -g @google/clasp`), `clasp login`, then in `apps-script/` run `clasp clone <script ID from Project Settings>` once and `clasp push` after every change.
4. Save, go back to the Sheet and reload it. A **Genotyping** menu appears.
5. **Genotyping > Set up (folders, templates, reminders)**. Approve the permissions (Google warns the app is unverified because it is yours: **Advanced > Go to MSU Sheep Genotyping**). Set up creates the Drive folders, the invoice and partner-bill Google Docs templates, the daily reminder trigger at 8am, and checks every tab's columns. It is safe to run again.

### 3. Deploy the web app
1. In the Apps Script editor: **Deploy > New deployment > Select type: Web app**. Description "v1", **Execute as: Me**, **Who has access: Anyone**. Deploy and copy the **Web app URL** (ends in `/exec`).
2. Paste it into `assets/js/config.js` (`API_URL`) and into Settings > `Web_App_URL` for reference. Commit and push.
3. After any later change to the Apps Script code: **Deploy > Manage deployments > (pencil) > Version: New version > Deploy**. This keeps the same URL. (A *new* deployment would get a new URL and you'd have to update `config.js`.)

### 4. The website (GitHub Pages)
1. Push this repo to https://github.com/CJPosbergh/MSUSheepGenotyping (it must be public for free GitHub Pages).
2. On GitHub: **Settings > Pages > Build and deployment > Deploy from a branch > main / (root) > Save**. The site appears at https://cjposbergh.github.io/MSUSheepGenotyping/ within a minute or two.
3. Nothing in the repo is secret: the passphrase lives only in the Sheet, and producer data never touches GitHub. Don't commit a filled-in tracker.

### 5. Try it end to end before going live
Submit the blank form filled in with your own email and two made-up animals, sign online, print the slip, receive it on `staff/receive.html`, create and cancel a batch. Then delete your test rows (Producers, Submissions, Animals, Invoices, Invoice_Lines, Email_Log, Batches) and the test folder in Drive/Submissions.

### 6. R (for results)
1. `install.packages(c("googlesheets4", "googledrive", "openxlsx", "jsonlite"))`
2. Install [Quarto](https://quarto.org/docs/get-started/) (you have it; it includes Typst, which draws the PDF). Check with `quarto --version` in a terminal. If R can't find it, set `QUARTO_PATH` in `~/.Renviron` to the full path.
3. Copy the `r/` folder somewhere handy. In `r/tracker_push.R` set `TRACKER_ID` to the Sheet's URL or ID.
4. In R: `source("r/tracker_push.R"); source("r/reports.R"); reports_auth()`. The first time a browser opens to sign in as cposbergh@gmail.com; tick every permission box.

---

## Day-to-day admin

| When | You do | Where |
|---|---|---|
| A submission arrives | Nothing. Check the Submissions tab if you like. | email E01/E02 goes out by itself |
| A box arrives | Staff receive it | `staff/receive.html` |
| After receiving | Check the invoice, add any extra lines, send it | Invoices tab, then **Genotyping > Send selected invoice…** |
| Box ready to ship | Staff create the batch and mark it shipped | `staff/batches.html` |
| GenomNZ results arrive | Push results, make files, release | R, then **Genotyping > Release results…** |
| A check arrives | Invoices: Status = Paid, Paid_Date, Check_Number | Invoices tab |
| End of each period | Make and send partner bills | Partner_Billing tab, **Genotyping > Send selected partner bill…** |
| A producer lost their link | Click their submission row, **Genotyping > Resend private link…** (E12) | Submissions tab |

Every menu command that sends email opens a preview where you can edit the subject and message first. Every email is logged on **Email_Log**.

Grey columns in the tracker are formulas: don't type in them. White columns are yours to edit. The website and Apps Script only ever read the white columns, so a broken formula can't break the site. **Genotyping > Check tracker columns** tells you if a column was renamed or deleted (the code looks columns up by their header, so don't rename headers; moving columns and adding your own columns at the end is fine).

**Staff passphrase.** To change it, type a new one in Settings > `Staff_Passphrase` and tell staff. Every staff browser is sent back to the sign-in screen on its next action. Staff type their name when signing in; it is recorded on each box received (`Received_By`) and each batch (`Created_By`).

If someone types wrong passphrases 20 times within 10 minutes, the staff pages pause for 10 minutes for everyone (this stops guessing). Use a passphrase of at least 12 characters.

**Gmail limit.** A free Gmail account can send about 100 emails a day from Apps Script. Batches mark-shipped emails count one per submission. If a send fails, the page or menu says so and Email_Log shows what went out.

---

## Cost-share

Cost-share is decided **per animal** when the invoice is drafted (at receiving).

- **The submission's program.** Set `Cost_Share_Program` on the Submissions row (e.g. CS01 for ASI). Do it before receiving, or recalculate the invoice afterwards.
- **Default level per animal** for that program:
  - Program has `Requires_NSIP = Y` (ASI) and the animal has **no NSIP_ID**: not covered, never.
  - **Proven** (at least `Proven_Min_Age` = 2 years old when the box is received: receipt year minus birth year, using the earliest year of a range like 2018-2020): **Full**, the partner pays the whole $18 (`Full_Share`).
  - Under 2: **Partial**, the partner pays $6 (`Partial_Share`) and the producer $12.
- **Exceptions, animal by animal** on the Animals tab:
  - `CS_Override_Level` = Full, Partial or None. For example an under-2 NSIP animal you want ASI to cover in full: Full.
  - `CS_Override_Program` = another program, such as GR01 for a grant, **case by case**. Give it a `CS_Override_Level` too (usually Full). This works for any animal, NSIP or not, unless that program also requires NSIP.
  - `CS_Program` and `CS_Level` (grey) show what actually applies.
- **After changing anything**, click the invoice row on Invoices and run **Genotyping > Recalculate selected invoice**. Sent invoices are locked and never change.

On the invoice, animals are grouped into one line per program and level, e.g. "Genotyping with conditions and parentage: covered in full by ASI" and "…: partly covered by ASI", with the partner's share subtracted as a credit. Animals without cost-share are on the plain line. The invoice does not describe what the program covers beyond that.

To add a program: a new row on Cost_Share (ID, name, partner organization with the short name in brackets like "American Sheep Industry Association (ASI)", contact, email, shares, Requires_NSIP, dates, Active = Y).

---

## Invoices and partner bills

**Producer invoices** are drafted automatically when a box is received (Invoices Status = Ready for review) with one GENO line per cost-share group. To send:
1. Check it on Invoices / Invoice_Lines. To charge for Tissue Sampling Units or anything else, add an Invoice_Lines row: same Invoice_ID, next Line_No, Service_ID (TSU is $2.75 each and never cost-shared; OTHER for anything else; CREDIT with a negative price for a discount), Description, Qty, Unit_Price.
2. Click the invoice row, **Genotyping > Send selected invoice…**, edit the email (E06) if you like, Send. A PDF is made from the invoice template, saved in the submission's Drive folder (`PDF_Link`), attached, and the invoice is marked Sent and locked.
3. When the check arrives: Status = Paid, Paid_Date, Check_Number.

Animals are billed once: `Animals.Billed_On` records the invoice. A sample that arrives after its invoice was sent (a late original) goes on a new invoice `INV-P003-01-2`. Replacements for failed QC are not billed.

**Partner bills** (e.g. ASI each quarter): add a Partner_Billing row with an ID (e.g. PB-CS01-2027Q1), Program_ID and the period dates. Full_Animals, Partial_Animals and Amount_Due fill in from producer invoice lines that are **Sent or Paid**, dated in the period, and not already on another partner bill. Click the row, **Genotyping > Send selected partner bill…** (E11 to the program's Partner_Email, PDF attached, saved to Drive/Partner bills). Sending stamps each included invoice line's `Partner_Bill`, so overlapping periods can never bill a line twice. Each line also keeps the partner's per-animal amount it was made with (`Share_Per_Unit`), so changing a program's shares later only affects new invoices. Record the check the same way as producer invoices.

**The PDF templates** are Google Docs in Drive/MSU Sheep Genotyping/Templates, made by Set up. Edit wording, logo, fonts and layout in Docs freely. Keep the `{{placeholders}}`: the table rows holding `{{line_desc}}` / `{{cs_label}}` / `{{pb_invoice}}` are copied once per line. To start over, delete the template, clear its ID in Settings and run Set up.

---

## Results in R (PDF and Excel)

After GenomNZ's data arrives and you have called genotypes:

```r
source("r/tracker_push.R"); source("r/reports.R")
reports_auth()

# 1. rename lab sample IDs (TSUs) to Animal_Keys for PLINK, if you need to
plink_id_files(batch = "B2026-01", prefix = "B2026-01")

# 2. condition calls: data frame with Animal_Key, Condition_ID, Genotype, Call
push_results(calls, failed = c("P003-01-26007"))   # failed = samples that failed QC

# 3. parentage: Animal_Key, Sire_Result, Dam_Result (+ Sire_Assigned, Dam_Assigned, Notes)
cands <- candidate_parents(lamb_keys)               # pool of genotyped sires/dams per lamb
push_parentage(parentage)

# 4. producer files: PDF + Excel per submission, saved to Drive and linked
results_reports(batch = "B2026-01")
```

- Everything pushed goes in with `Released = N`: producers see nothing yet. Calls must match a row on **Result_Key** (the call-to-label table), or nothing is written and you get a list of problems.
- `failed` animals get Sample_Status = Failed QC: after release their page asks for a replacement TSU.
- `results_reports()` writes `reports/<ID>_<Flock>_results.pdf` and `.xlsx` locally, uploads both to the submission's Drive folder (replacing older versions) and fills `Results_PDF` / `Results_Excel`. Use `results_report("P003-01", upload = FALSE)` to just look at one.
- The PDF lists every **active** condition (Conditions > Active = Y), including ones not shown on the web page (Show_On_Web = N); the Excel file has a Results sheet (one row per animal, every call and parentage result, filterable) and a How to read sheet built from Conditions and Result_Key.
- **Check the files**, then in the Sheet click the submission row and **Genotyping > Release results for selected submission…**. That sets Released = Y, sets the status to Results released, shows results on the producer's page with the download buttons, and sends E08 (or use "Release without emailing").
- When replacement results come in later: push them, run `results_report()` for that submission again (the files are replaced), and release again.
- The PDF layout is `r/results_template.typ` (Typst). Wording like "How to read these results" and "What to do next" is there and in `reports.R`; condition explanations come from the Conditions tab.

To add a condition: add a Conditions row (ID, name, gene, Show_On_Web, Active = Y, Sort_Order, Explanation) and one Result_Key row per possible call with its label and category (good / mid / bad = blue / amber / red). The web page, PDF and Excel pick it up.

---

## Editing wording (emails, pages, PDFs)

- **Emails**: the **Email_Templates** tab (E01–E12). Edit subjects and bodies right there; changes apply to the next email. `{Placeholders}` like `{First name}`, `{Submission ID}`, `{Private link}`, `{Packing slip link}`, `{Mailing address}`, `{Drop-off location}`, `{Contact email}` are filled in; keep the braces and spelling. `{#if missing}…{/if}` blocks only appear when that case applies. If a placeholder is misspelled the email still sends, showing the braces, so send yourself a test.
- **Web pages**: the `.html` files. The consent terms appear in three places that must match: `index.html` (consent section), `sign.html`, and the paper consent form (Drive). The page-by-page scripts are in `assets/js/`.
- **Settings**-driven text (addresses, hours, contact, links, birth flock for GenomNZ) changes everywhere at once.
- **Invoice / partner bill PDFs**: the Google Docs templates (above). **Results PDF**: `r/results_template.typ`.
- `docs/forms/` has editable copies of the consent form and the blank submission form. After changing the submission form's columns, update `assets/js/validate.js` (it reads columns by header name) and run `sh tools/sync.sh` to copy the rules to `apps-script/Validate.gs`.

---

## Privacy, photos, research withdrawal and NSIP

- **Private links.** Each submission has a random 12-character token; anyone with the link can see that submission, so producers are told not to share it. Pages carry `noindex`. To cut off a link, give the submission a new `Private_Link_Token` (12 letters/digits) and resend the link.
- **Photos** are optional and research-only (kept only when research use = Yes). They go to Drive/Submissions/<ID Flock>/Photos and are logged on the Photos tab. Every so often, download them to long-term storage off Google, fill `Archived_Date` and `Archive_Location`, and delete them from Drive (the account has 15 GB).
- **Research withdrawal.** A producer emails you. Set the submission's `Research_Use` = N and `Research_Withdrawn_Date`, and delete their photos from Drive and the archive. Results are unaffected.
- **NSIP.** Genotypes of NSIP-enrolled animals are shared with NSIP outside this system, from the genotype files kept locally (too large for Sheets). Producers aren't asked and the pages and emails don't report when it happened; the consent terms say NSIP-enrolled animals are shared.
- **Staff pages** check the passphrase on the server for every action; it is never in the page code. The browser remembers it until **Lock**. Staff can't see producer contact details beyond what's on the packing slip.

---

## Changing the code and testing

```
apps-script/      back end: paste into the Sheet's Apps Script project (Schema.gs and Validate.gs are generated)
assets/           css, js (one file per page + shared common.js, staff.js, scanner.js, validate.js), vendor libraries, GenomNZ template
staff/            receiving and batches pages
r/                tracker_push.R, reports.R, results_template.typ, logo.svg, tests
tracker/          START (blank) and EXAMPLE trackers
tests/            mock Google services, back-end test, browser test, local server
tools/            gen_schema.py (tracker columns -> Schema.gs), sync.sh (validate.js -> Validate.gs)
docs/             staff guide, editable forms
```

Tests run the real Apps Script code against a copy of the tracker with Google's services mocked, so nothing touches the live Sheet or sends email:

```
npm install
npm test                          # 140 back-end checks, then 62 browser checks (Chromium via Playwright)
Rscript r/tests/test_reports.R    # 18 checks of the R reports (PDF needs Quarto)
npm run serve                     # the whole site on http://localhost:8080 with a mock back end (staff passphrase: test)
```

After adding or renaming tracker columns, regenerate `apps-script/Schema.gs` from the tracker builder's schema export (`python3 tools/gen_schema.py tracker_schema.json`), paste it into Apps Script and run **Check tracker columns**. Libraries in `assets/vendor/` (SheetJS, ExcelJS, qrcode-generator) are bundled so the site works without other CDNs.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Pages say "Could not reach the server" | `assets/js/config.js` has the wrong URL, or the deployment's access isn't "Anyone". Opening the `/exec` URL in a browser should show `{"ok":true,…}`. |
| Changes to Apps Script don't show on the site | You saved but didn't deploy a new version (Manage deployments > edit > New version). |
| "That passphrase is not right" | Settings > `Staff_Passphrase` is blank or different. |
| Email links point to the wrong place | Settings > `Site_URL`. |
| Invoice PDF fails | Template deleted or its ID cleared: clear `Invoice_Template_ID` and run Set up. |
| A producer's form is rejected | The page lists each problem by row. Common ones: EIDs shown as 8.40003E+14 (format the column as Text and retype), the EXAMPLE row left in, a TSU used before. |
| Reminders stopped | Apps Script > Triggers: `dailyReminders` should be there; run Set up to add it back. |
| The camera button is missing on a phone | Camera scanning needs Chrome or Edge (Android, Windows, Mac). On iPhone, use a Bluetooth scanner or type the barcode. |
| A "Something went wrong on our side" error | Apps Script > Executions shows the error and which action caused it. |
