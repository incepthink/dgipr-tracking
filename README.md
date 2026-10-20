# DGIPR publicity tracking & reporting

A manually triggered tool that collects public social-media publications, finds the ones relevant
to a campaign (e.g. **दुष्काळ उपाययोजना**), lets an operator review them, and produces the Marathi
division/district publicity report in the format of the reference PDF (`13.10.2026 for print.pdf`).

Account owners do nothing: collection uses **our own** provider accounts (Apify, TwitterAPI.io,
YouTube Data API; Bright Data as an interchangeable alternative). No OAuth, no logins.

---

## 1. Setup

Requirements: Python 3.12+, and either Playwright's Chromium or an installed Edge/Chrome (for PDFs).

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # Windows (use .venv/bin on Linux/macOS)
.venv/Scripts/playwright install chromium         # or set PDF_BROWSER_CHANNEL=msedge to use Edge
cp .env.example .env                              # then fill in credentials
.venv/Scripts/uvicorn app.web.main:app --port 8000
```

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` before the first start: if no state user exists yet, that
account is created as the state admin. Open http://localhost:8000 and log in. Every action is audited under the
logged-in username. On first start the database is created and loaded from `config/`:

### Web interface (React)

`/` opens the React operator UI at `/app/` (source in `frontend/`: Vite + React + TypeScript +
Tailwind, shadcn-style components). It talks to the JSON API in `app/web/api.py`, which reuses the
same validation and audit helpers as the original server-rendered pages. Those pages are still
available at `/classic`. The built UI is committed to `app/web/spa/`, so production needs no Node.

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173/app/ — hot reload; proxies /api etc. to the backend on :8000
npm run build    # rebuilds app/web/spa/ (served by uvicorn at /app/)
```
Use `DGIPR_BACKEND=http://127.0.0.1:8765 npm run dev` if the backend runs on another port.

| File | Purpose |
|---|---|
| `config/organisation.yaml` | divisions → offices/districts, order, labels, which district page each division prints on. Synced on every start. |
| `config/accounts.yaml` | initial account registry (seeded once; then edited in the UI) |
| `config/campaigns/*.yaml` | campaign keywords/phrases/hashtags/exclusions (mr/hi/en), thresholds, count rules (seeded once; then edited in the UI) |
| `config/report_format.yaml` | PDF heading templates, labels, footer, fonts |

### Login, access levels and report forms (अहवाल फॉर्म)

Everything requires a login (username + password, an HttpOnly `dgipr_session` cookie, 14 days by default, `SESSION_DAYS`).
The state admin creates accounts under **Admin → Users**. **Create all office accounts** makes one district account per office
(username = office code, e.g. `solapur`; विमाका offices included, e.g. `pune_rio`) and one view-only zone account per division (`zone_<division>`). It shows temporary passwords
once, and you can download them as CSV. Users must change the temporary password at first login.

| Role | Sees | Enters figures for |
|---|---|---|
| district | its own office | its own office, for the forms sent to it |
| zone (विभाग) | every office in its division: submissions and analytics | nothing (view only) |
| state | everything, including **Social Monitoring** (Collect → Review → Report, runs, accounts, rules, audit) and **Admin** | builds forms; reviews, returns and corrects submissions |

Access is default-deny (`app/auth.py`): every route except login, static files and the report-forms API (`/api/forms`) is state-only.

**Report forms (अहवाल फॉर्म)** replace the Excel sheet the state office sends round (`दुष्काळ_प्रसिद्धी_अहवाल_….xlsx`):
* **Forms** (state): build a form with a Marathi/English title and instructions and its fields (number, text, yes/no, dropdown or date; required, min/max). Then pick the offices it goes to (all, or by division), how often it is filled (daily, weekly or one-time), its dates and a deadline, and publish it. After an office has answered a field, that field can be renamed, reordered or archived but not deleted or retyped. **Duplicate** copies a form for the next campaign.
* **My forms** (offices): the forms sent to the office, with their instructions and what is pending, overdue or returned. On a phone each period is one card; on a desktop it's a week grid that accepts Excel paste. A blank field stays *not entered*, and saving a 0 needs a "confirm zeros" tick. **Submit** locks the period until the state office returns it.
* **Responses** (state; zone read-only): everyone's data combined, like the डेटा एंट्री sheet. The state office can **accept** a submission, **return** it with a note, or **correct** a value. A correction keeps the office's original value and the reason, and the cell shows yellow. The compliance tab shows offices × periods coloured by status (late ones outlined), and one click copies the list of offices that haven't sent, for WhatsApp follow-up.
* **Analytics** and **Tables & export**: totals, trend, rankings and the sheet's five tables for any form. **Full workbook** exports one xlsx with सूचना, डेटा एंट्री and the five roll-up sheets. It uses the sheet's own names, and corrected cells are yellow with the original value in a comment.

Only submitted, accepted or returned periods count in totals; drafts don't. Every save, submit, return, accept and correction is audited.

**The PDF report uses the submitted figures for all 12 columns** of the campaign's linked form (Form → Social Monitoring campaign). Values are summed over the days, and a cell is complete only if every day was submitted. Collected social-media counts stay in each cell as a cross-check (`↻ n` on the Report page); their problems are warnings only. Periods without submitted values keep the earlier behaviour.

**Upgrading from office entries.** On first start with no forms, the app moves the old `office_entries` into a published daily form per campaign: same 12 fields, every office a recipient, each office-day a submitted period. The old table is left untouched as a backup. **Back up the database first** (on EC2: copy `data/dgipr.sqlite3`). You can also run the move by hand; it is safe to re-run:
```bash
python scripts/migrate_entries_to_forms.py --dry-run
python scripts/migrate_entries_to_forms.py
```

Import the sheet history into a form. Only filled cells are loaded, and each office-day becomes a submitted period. It is re-runnable and audited as `import:xlsx`:
```bash
python scripts/import_sheet.py samples/office_sheet_2026-10-15.xlsx --dry-run   # prints the state total; must equal the sheet's राज्य एकूण
python scripts/import_sheet.py samples/office_sheet_2026-10-15.xlsx --form drought_measures
```

### Try it without credentials (sample data)

```bash
.venv/Scripts/python scripts/load_sample.py
```
builds a separate sample database with **synthetic fixture responses** through the real adapters,
plus manual values transcribed from the reference PDF, and writes:

* `samples/sample_report_2026-10-12.pdf` — final-format report, watermarked **नमुना माहिती · SAMPLE DATA**
* `samples/sample_draft_incomplete.pdf` — the draft before review and manual entry (shows “–” for missing and “*” for incomplete)
* `samples/sample_snapshot_2026-10-12.json`, `sample_evidence_…csv`, `sample_matrix_…csv`
* `samples/comparison/page{1-4}_side_by_side.png` — reference (left) vs generated (right)

To run the whole UI on fixtures, set `PROVIDER_FACEBOOK/INSTAGRAM/X/YOUTUBE=fixture` in `.env`.
Everything collected this way shows the provider as `…[FIXTURE]`.

## 2. Credentials needed

| Variable | Where to get it | Used for |
|---|---|---|
| `APIFY_TOKEN` | Apify Console → Settings → API & Integrations | Facebook (`apify~facebook-posts-scraper`) and Instagram (`apify~instagram-scraper`) |
| `TWITTERAPI_IO_KEY` | twitterapi.io dashboard | X (`/twitter/user/last_tweets` or `/twitter/tweet/advanced_search`) |
| `YOUTUBE_API_KEY` | Google Cloud Console → enable *YouTube Data API v3* → API key (restrict it to that API) | YouTube (`channels`, `playlistItems`, `videos`) |
| `BRIGHTDATA_API_KEY` | Bright Data → Account settings → API key (only if a platform is switched to `brightdata`) | Facebook/Instagram alternative |

Keys live only in `.env`/environment variables on the server. They are sent as headers where the
provider allows it (Apify/Bright Data `Authorization: Bearer`, TwitterAPI.io `X-API-Key`); the
YouTube key must be a query parameter and is redacted from every stored error message and log.
The UI shows only whether a credential is configured.

## 3. Operating the workflow

1. **Collect** (`/runs/new`): pick the reporting date or range (Asia/Kolkata), campaign and accounts,
   and start the run. Progress, per-account coverage, provider usage and errors refresh live on the run page.
   * *Full window* re-fetches the period (also refreshes engagement metrics). *Incremental* only fetches
     time not already covered by an earlier complete collection.
   * The request window is the period ± `OVERLAP_HOURS` (default 6 h), so posts near IST midnight or
     indexed late are not missed. Reruns never duplicate: publications are keyed by platform + stable ID,
     with aliases (canonical URL, video IDs) so a reel returned by two endpoints is stored once.
   * **Retry failed / partial tasks** resumes async provider jobs (Apify run / Bright Data snapshot) and cursors where possible.
2. **Review** (`/review`): each publication shows its text with matched terms highlighted, the automatic
   decision (`match`, `needs_review`, `insufficient_text`, `no_match`) with reasons, whether count rules let
   it count, and Include/Exclude/Reset buttons. Overrides of uncertain or contrary decisions need a note.
   “Accept all proposed matches” records each acceptance individually in the audit log.
3. **Report** (`/report`):
   * Automated cells (Facebook/Instagram/X/YouTube for offices with registered accounts) link to their publications.
   * All other cells are **manual**: an empty field means *not entered* and is never treated as zero.
     To record zero, enter `0` **and** tick `0✓`.
   * The completeness panel lists blockers: missing manual values, collections that did not fully cover the
     period, items awaiting review, unconfirmed account mappings.
   * **Preview draft PDF** / **Save draft snapshot** work at any time (watermarked प्रारूप · DRAFT).
     **Approve final report** is disabled until there are no blockers.
4. **Snapshot** (`/reports/{id}`): the frozen dataset with PDF, evidence CSV, values CSV and JSON.
   PDFs are rendered only from the snapshot, so later collections or metric changes never alter an approved
   report; a new final for the same period supersedes the old one (audited). The snapshot shows a hash check.

Accounts (`/accounts`): register more accounts and map each to its office. Mappings are explicit and must be
confirmed; the four seeded DGIPR handles are *proposed* as मुख्यालय, मुंबई and stay unconfirmed until an operator confirms them.

## 4. Architecture

```
app/
  registry/loader.py        organisation, accounts, campaigns from config/ → DB
  providers/base.py         provider contract: capabilities, CollectionRequest, FetchPage, ProviderError
  providers/{apify,brightdata,twitterapi_io,youtube}.py   adapters
  providers/http.py         retries, Retry-After, error classification, request counting, redaction
  providers/factory.py      the only place that maps platform → provider
  providers/fixtures.py     offline synthetic responses (httpx MockTransport)
  normalize/*.py            raw provider item → NormalizedPublication (missing metrics stay None)
  collection/service.py     orchestration, window-coverage decisions, partial/failed handling
  collection/store.py       raw records, upsert + alias dedup, coverage ledger
  collection/executor.py    background execution (reusable by a future scheduler)
  classification/           Classifier interface, keyword classifier, count rules, audited overrides
  reporting/aggregate.py    one-pass computation of district cells, subtotals, grand totals, issues
  reporting/snapshot.py     frozen snapshots, final-approval gate
  reporting/pdf.py + templates/report.html   HTML → PDF through Chromium (HarfBuzz shaping)
  web/                      FastAPI server-rendered UI
```

Persistence (SQLite by default, `DATABASE_URL` for others): accounts and mappings, campaigns (versioned),
collection runs and per-account tasks, raw provider records (separate from normalised publications),
publications with provenance, classifications and manual overrides, manual inputs, report snapshots and
PDFs, coverage intervals and the audit log.

**Adding a scheduler later:** call `create_run(..., trigger_source="scheduler")` then
`RunExecutor.submit(run_id)` (or `execute_run` directly) from cron/APScheduler. Nothing in the UI is required.

## 5. Replacing or adding a provider

1. Write an adapter implementing `ProviderAdapter` (`app/providers/base.py`): declare `capabilities`,
   yield `FetchPage`s from `fetch_pages()` (raise `ProviderError` on failure; pages already yielded are kept),
   and implement `normalize()` returning `NormalizedPublication`. The stable ID must be the **platform's** ID
   (e.g. Instagram shortcode, tweet ID), not a provider-internal one, so data from old and new providers deduplicates.
2. Register a builder in `BUILDERS` in `app/providers/factory.py`.
3. Set `PROVIDER_<PLATFORM>=<name>` in `.env`.

Classification, aggregation, UI and PDF code are unaffected. Switching Facebook/Instagram from Apify to
Bright Data is only `PROVIDER_FACEBOOK=brightdata` / `PROVIDER_INSTAGRAM=brightdata` plus `BRIGHTDATA_API_KEY`.

## 6. The report format

Built from the reference PDF (4 pages, A4 landscape). Column widths, row heights, table positions and page
grouping were measured from the reference's drawing commands:

* Page 1: two-line heading (`माहिती व जनसंपर्क महासंचालनालय, मंत्रालय मुंबई-३२` / `{campaign} विभागनिहाय प्रसिद्धी अहवाल दि. {date}`),
  header row with the 14 columns in reference order and spelling (incl. `इन्सटाग्राम`, `पब्लीक ॲप`,
  `उपक्रम/ मावजस होर्डिंग, महासंवाद`), 9 division rows, `एकूण` row.
* Pages 2–4: `{campaign} जिल्हानिहाय प्रसिद्धी अहवाल दि. {date} अहवाल` (wording kept verbatim), then division bands,
  district rows and `एकूण` subtotals: Nagpur/Pune/Chh. Sambhajinagar, then Konkan/Kolhapur/Nashik, then Amravati/Latur/मुंबई (no subtotal).
* Devanagari digits, Marathi month names, date ranges (`१० ते १२ ऑक्टोबर २०२६`).
* Font: Noto Serif Devanagari (SIL OFL, static Regular/Bold in `app/static/fonts`), embedded in every PDF.

Deliberate differences from the reference:
* The reference uses the proprietary C-DAC “DVOT Surekh” font, which can't be redistributed. The substitute is a little
  narrower, so on page 1 “कोल्हापूर विभाग” and “अमरावती विभाग” fit on one line instead of wrapping, and those rows are shorter.
* District rows are numbered consistently within each division (the reference numbers only some).
* The empty box under the Chh. Sambhajinagar section on page 2 of the reference (a Word layout leftover) is not reproduced.
* A small footer gives the PDF generation date/time, which is distinct from the reporting date. Turn it off in `report_format.yaml`.
* **The reference's Konkan subtotal does not add up**: its district rows sum to Facebook 4, Instagram 4, X 4,
  Public App 3, but its `एकूण` row (and page 1) show 2, 2, 2, 1. It omits the “विमाका कोकण” row, while Nagpur's subtotal includes
  “विमाका, नागपूर”. This tool always computes subtotals and totals from the district rows, so with the reference's own
  district values page 1 reads Facebook 69 / Instagram 56 / X 62 / Public App 16 instead of 67 / 54 / 60 / 14.
  Confirm which rule DGIPR intends; if “विमाका” rows should be excluded from subtotals, that would be a configuration change.

## 7. What was tested, and how

**No live API call was made.** No credentials were available, so nothing was collected from the real
accounts and no provider integration has been validated against a live service.

* **Provider integrations** were written against the providers' current public documentation (checked Oct 2026):
  Apify run/dataset API and the two actors' input schemas, TwitterAPI.io `last_tweets` / `advanced_search`,
  YouTube `channels.list?forHandle`, `playlistItems.list`, `videos.list`, and the Bright Data trigger/progress API
  with dataset IDs. Things the public docs leave open, which **must be checked on the first live run**:
  * Bright Data snapshot download path (`/datasets/v3/snapshot/{id}?format=json`) and the `start_date`/`end_date`
    format (`BRIGHTDATA_DATE_FORMAT`).
  * Whether TwitterAPI.io's timeline returns pinned tweets, and whether the response is top-level `tweets` or
    `data.tweets`. Both are handled, but this hasn't been observed live.
  * How completely the Apify actors cover each page/profile for a given date window. Marketplace descriptions are not a
    guarantee, so watch the per-account “window covered” column and the `items_in_window` counts.
* **Automated tests** (`pytest`, 44 tests, all passing) use `httpx.MockTransport` and synthetic fixtures. They cover
  pagination and resume state for each adapter, retry/Retry-After/auth-error handling and key redaction, normalisation
  (including missing metrics staying `None`), dedup across endpoints and safe reruns, Asia/Kolkata date boundaries,
  Marathi/Hindi/English matching (inflections, ZWJ, hashtags, exclusions), audited overrides surviving
  reclassification, count rules, missing vs confirmed zero, totals consistency, the final-approval gate, snapshot
  immutability, partial/failed/interrupted collections, and PDF page count/size/embedded fonts.
* **End to end**: the web UI was driven over HTTP (collect → rerun → draft → confirm mappings → review →
  manual entry → final approval) on fixture providers, and the generated PDFs were rendered to images and compared
  page by page with the reference.

Run the tests with `pytest` (set `PDF_BROWSER_CHANNEL=msedge` if Playwright's Chromium isn't installed; the PDF
test is skipped when no browser is available).

## 8. Limitations

* **Text-only relevance.** No image OCR, video/audio transcription or semantic/AI classification is implemented, and
  media is never downloaded. Posts whose relevance can't be judged from text are flagged `insufficient_text` for a human.
  The `Classifier` interface (`app/classification/base.py`) is where such capabilities would plug in.
* **YouTube Shorts**: the Data API has no Shorts flag. `is_short` stays unknown, and a `possible_short` hint (≤180 s) is
  recorded. With `include_shorts: false` those hinted videos are excluded and the reason is shown.
* **Video bites / video interviews** are manual by default. They can be counted from reviewer tags
  (`video_bites_source: reviewer_tag`), never automatically from the presence of a video.
* **Columns without data sources** (articles, news, clippings, blog, Public App, activities/hoardings/Mahasamvad, and the
  platform columns for offices without registered accounts) are manual inputs.
* **Coverage**: only the four state-level accounts are registered. District/office accounts must be added and mapped
  before their platform columns become automated.
* Apify's `onlyPostsNewerThan` has no upper bound and may still return pinned posts. Counting always uses each
  publication's own timestamp converted to Asia/Kolkata, and pinned items never decide when paging stops.
* Provider cost is tracked where the provider reports it (Apify `usageTotalUsd`, YouTube quota units, request counts).
  TwitterAPI.io and Bright Data costs are not reported per call.

## 9. Production deployment

* **Frontend**: Vercel project `dgipr-tracking` (team `hashcase`) → https://dgipr-tracking.vercel.app.
  `frontend/vercel.json` serves the SPA at `/app/` and rewrites every other path (`/api`, `/reports`, `/report/preview.pdf`,
  `/fonts`, `/classic`, …) to the backend. Redeploy: `cd frontend && vercel deploy --prod --scope hashcase`.
* **Backend**: AWS EC2 `dgipr-prod` (t2.small, ap-southeast-1, Elastic IP 54.169.233.35), Docker Compose in `/opt/dgipr/deploy`:
  the app (`Dockerfile`, Playwright Chromium) plus Caddy for HTTPS at https://54-169-233-35.sslip.io (Let's Encrypt).
  SQLite and PDFs live in `/data/dgipr` on the host. Secrets are in `/opt/dgipr/deploy/app.env` (mode 600), including
  `ADMIN_USERNAME` / `ADMIN_PASSWORD` for the first state admin. The site requires login. SSH is allowed only from the admin IP in security group `dgipr-prod`.
* **Before a deploy that changes the schema**, back up the database: `sudo cp /data/dgipr/dgipr.sqlite3 /data/dgipr/dgipr.backup-$(date +%F).sqlite3`.
  New tables are created and new columns added automatically on start.
* **Redeploy backend** (from the repo root):
  ```bash
  tar --force-local --exclude=__pycache__ -czf /tmp/dgipr.tgz Dockerfile .dockerignore requirements.txt app config scripts deploy
  scp -i ~/.ssh/dgipr-prod /tmp/dgipr.tgz ubuntu@54.169.233.35:/opt/dgipr/
  ssh -i ~/.ssh/dgipr-prod ubuntu@54.169.233.35 'cd /opt/dgipr && tar xzf dgipr.tgz && cd deploy && sudo docker compose up -d --build'
  ```
