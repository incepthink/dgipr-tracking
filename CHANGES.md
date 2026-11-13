# Changes — 13 Nov 2026 (round 2, frontend only)

No backend change, no migration: this round only needs the Vercel deploy (and `app/web/spa/` is rebuilt).

- **Responses: type figures straight into the table** (`pages/forms/Responses.tsx`). Every figure cell is now an input
  box: type, then Enter (saves, moves to the office below), Tab, or click away; Escape puts the saved figure back;
  ↑/↓ move between offices. Uses the existing `POST …/submissions/{office}/{period}/field`. The scrolling
  "whole office-day" sheet from round 1 is **removed** (also its strings in `i18n.tsx`). Saves are sent one at a time
  (fast typing on a day nobody has sent made two requests race to create the same submission → 500 `UNIQUE constraint
  failed: form_submissions…`; the backend still has that race for truly parallel requests).
- **Evidence column: small "⬆ PDF" button** on each row ("PDF · 3" once files are attached). It opens a small box
  with one **Upload PDF / photo** button (**several at once**) and the **list of files already attached** to that
  office-day (all fields), each opening in a new tab. The state office does **not** pick a column: files are saved
  under the form's files-only field (`proof: "files"`, i.e. newspaper clippings; else the first field taking files),
  through the same `/field` save. So Analytics → Posts counts table uploads under that field. The old "View · n" chip
  and its proof popup (`ProofModal`) are **removed**. Pasting
  *links* from the Responses page is no longer offered (offices still paste links on their fill page).
- Responses table look: **every row plain white** (no green "sent" / red "returned" row colour; the Sent column says
  it), **no red "proof missing" dots** in the cells, **all figures black** (edited ones were purple with a corner
  mark; the edit is still in the cell's tooltip and in History), and the **"Missing proof only" filter button is
  removed** (the "n without proof" count chip stays).
- **Undo button beside "Full screen"**: takes back the last figure typed or the last batch of files, one step per press,
  with the count, e.g. "Undo (3)".
- Responses count chips ("86 of 360 sent", "2 edited", "23 without proof") are now **one plain colour** (light grey,
  dark text, square-ish corners; white on the grey date band) instead of green / purple / red tints (`CountChips`).
- **Analytics → Overview: the four number boxes and the "Today's review" box are plain white** (were red / yellow /
  green / blue tinted; `Kpi` in `pages/insights/Overview.tsx`, `components/analytics/BriefCard.tsx`).
- **District office home (My forms)**: the heading "जिल्हा माहिती अधिकारी: <office>" is smaller (24 / 28 px) and
  centred with its date and division; the card facts (कालावधी etc.) **wrap instead of being cut off** with "…"
  (`pages/forms/MyForms.tsx`). The filter chips (सर्व / राज्याने बदललेले / परत पाठवलेले) sit **in one row on a phone**
  (smaller, no wrapping; full size from `sm` up).
- **Search boxes on phones** (`DeskSearch` on Desk / Forms / My forms, `RSearch` on Responses): smaller hint text,
  icon and padding so "फॉर्म किंवा मोहिमेचे नाव शोधा…" isn't cut. Typed text stays 16 px (smaller makes iPhones zoom
  in on focus). Desktop unchanged.
- **Pop-up messages (toasts) are plain white** with dark text and a thin border, app-wide (`main.tsx`: `richColors`
  removed, card/ink colours). They were filled green / red.
- Fix: with the page in Google Translate, the PDF button showed "PDF ⬆ PDF" after an upload (the translator kept the old
  text node when the button switched back from "uploading"). The button is now `translate="no"` and always has the same
  children. Checked by wrapping text in `<font>` like the translator does.
- Responses: the **"All dates" button is outlined** when picked (dark border, white inside) instead of solid black,
  matching the date picker beside it.
- **"Fill response" now opens the Responses table** (state office): the Desk / Forms header button goes to
  `/forms/responses?form=<id>&day=<today>` (straight there with one live form, else after picking the form), and the
  Desk's per-office "Review / View" link opens Responses at that day with **that office picked in the district
  filter** (`&office=<code>`), only that form open. (A first version searched by office name, which also matched
  other जिमाका of the same division, e.g. Solapur and Satara for Pune.) The duplicate "Fill response" button on each Forms card is removed (its "Responses" button stays). The office
  fill page (`/forms/:id/fill`) is unchanged and still what district / zone users use.
- Only this form's table reloads after a save (it used to reload every form's table; Form 2's month took ~1 s).
- **Main buttons and the "Form 1/2" badges are now the sidebar's dark navy** (`--r-brand` in `index.css`, used by
  `RButton variant="pri"` in `components/reports/kit.tsx` and `FormNumber` in `pages/forms/common.tsx`): New form,
  Publish and every other main button. Links and focus rings stay blue.
- Reporting calendar (Form analytics): colour key at the top, month row, weekday + date per column, Sundays in red,
  visible "not due yet" dot (`components/analytics/CalendarHeatmap.tsx`).
- "Totals by medium" boxes: small sparkline removed (`components/analytics/GroupTile.tsx`).

## 14 Nov 2026: Form analytics keeps its picks in the address

Report: "the dashboard reloads after a minute and the selected KPI is lost". The app has no auto-refresh (checked:
no timer or refetch on these pages, the live HTML has no refresh, sessions last days; the Desk and Form analytics
watched 2½ min with zero reloads). The likely source is the Vite **dev** server used for phone testing, which reloads
the page when its connection drops. Fix anyway: the Form analytics picks (KPI field or group `col` / `grp`, table view
`view`, ranking level `level`, map metric `map`) are now kept in the URL (`replace`, no history entries), so any reload,
Back or shared link keeps them (`pages/office/Analytics.tsx`). Frontend only.

## ✅ Live data changes, 13 Nov 2026 (after the deploy)

- **महाराष्ट्र परिचय केंद्र, नवी दिल्ली / पणजी, गोवा added as recipients** of live forms 1 (`drought_measures`) and 5
  (`mahatma_phule_bicentenary`): every live form had only 43 recipients because they were created before these offices
  existed (4.11.2026). Forms 2–4 (ended / test) unchanged. The two offices have no user accounts yet. Backup:
  `dgipr.backup-2026-11-13-1730-before-mic.sqlite3`.
- **39 real post links from the state DGIPR accounts** (Facebook 21, Instagram 12, X 6; posts of 13 Nov 2026, supplied by
  the state office) added to form 1, office `mumbai_hq` (the DGIPR handles' office in `config/accounts.yaml`), day
  13 Nov, via `service.set_field` as `admin`: figures facebook 21 / instagram 12 / x 6 = their links, day "sent by the
  state office". They show in Analytics → Posts. Backup: `dgipr.backup-2026-11-13-1745-before-posts.sqlite3`.

## ✅ DEPLOYED 13 Nov 2026 ~23:00 IST: frontend (round 2) to Vercel production

`vercel deploy --prod --scope hashcase` from `frontend/` (incepthink login; CLI ≥ 47.2.2 is now required, older ones are
refused). New production deployment `dgipr-tracking-348co037h`; previous one, for rollback: `dgipr-tracking-5u0hsfmcz`
(Vercel dashboard → Deployments → … → Promote / Instant Rollback). Backend not redeployed: the server's `app/`, `scripts/`
and `config/` were checked file by file and are identical to this copy. `npm run build` done, so `app/web/spa/` is
rebuilt; 122 tests pass. The Vercel project is **not** connected to GitHub, so a push does not deploy.

## ✅ DONE on the live server, 13 Nov 2026 ~22:30 IST: drought workbook imported

- Backup first: `/data/dgipr/dgipr.backup-2026-11-13-1636-before-excel.sqlite3` (SQLite backup API, integrity ok).
- Live form **1 `drought_measures` (दुष्काळ उपाययोजना)**: start date moved **17 Oct → 1 Oct 2026** (audited), then the
  workbook imported with `scripts/import_sheet.py`'s logic: 1,500 office-days, 1 Oct → 12 Nov, all "submitted", audited as
  `import:xlsx`. One exception: **Pune 3 Nov keeps the office's own लेख (2) and इन्स्टाग्राम (2)**, which carry proof links
  (the workbook said 0 and 5, which the links-must-match rule refused). Pune's other three live days (17/18 Oct, 8 Nov,
  test-looking entries) were replaced by the workbook's figures.
- Live totals 1 Oct–12 Nov now: `[45, 983, 16195, 160, 25, 2678, 2229, 2627, 855, 434, 692, 2]`. That's the workbook's
  राज्य एकूण except लेख +2 and इन्स्टाग्राम −3 (the Pune 3 Nov exception). Other forms untouched (52 submissions).
- Access used: a new deploy key added to `ubuntu`'s `authorized_keys` (comment `dgipr-deploy-2026-11-13`) and two SSH
  rules on security group `dgipr-prod` (a /24 for the deploy PC, `3.0.5.32/29` for EC2 Instance Connect). Remove them
  when no longer needed.

## Loading the real drought workbook into the live database (optional, only if the state office asks)

The state office's workbook `दुष्काळ_प्रसिद्धी_अहवाल-12.11.2026(2).xlsx` (sheet डेटा एंट्री, 1 Oct → 12 Nov 2026) loads
cleanly with the **existing** `scripts/import_sheet.py`: 1,500 office-days, 43 offices, every name recognised, and the
totals equal the workbook's own राज्य एकूण row (`[43, 983, 16195, 160, 25, 2678, 2232, 2627, 855, 434, 692, 2]`).
Tried on a test copy only; Analytics then shows exactly those totals. No code change is needed. On the server:
1. **Back up the DB.** Copy the xlsx to the server.
2. `python scripts/import_sheet.py FILE.xlsx --dry-run` (no writes; the totals above must print).
3. Check the live drought form's **slug** and **start date**. The importer's default slug is `drought_measures`; pass
   `--form <slug>` if it differs. Days before the form's start date don't show in Analytics, so move the start to
   1 Oct 2026 in the form builder if it is later.
4. `python scripts/import_sheet.py FILE.xlsx --form <slug>`. Every office-day becomes "submitted"; a value already
   there for the same office-day-field is **overwritten** by the workbook's (re-runnable, audited as `import:xlsx`).
   Days on or after the form's "proof from" date will count as "without proof" (the workbook has no links/files).

# Changes — 8–9 Nov 2026 (UI feedback round)

Handover for whoever deploys. Everything below was made on the copy of the repo shared in Nov 2026, driven by the
state office's UI testing (staff are not technical: obvious labels, plain-word buttons, fewer clicks).
**Tests: 122 passed** (`pytest`). **Frontend: `tsc -b` clean, `npm run build` done** — `app/web/spa/` is rebuilt.

## Deploy — order matters

1. **Backend first** (new endpoint + one permission change; no schema change, no migration). Back up the DB first
   (README §9, SQLite backup API), then the usual tar → scp → `docker compose up -d --build`.
2. **Then Vercel** (`cd frontend && vercel deploy --prod --scope hashcase`). The new frontend calls the new endpoints;
   if it goes first, the Responses edit sheet's Save and Analytics → Posts fail until the backend catches up.
3. Smoke test on the live site: Responses → click a cell of an office that sent nothing → fill 2 fields + a proof →
   Save all; Analytics → Posts lists it; Desk → Send on WhatsApp opens WhatsApp with the text.

## ⚠ Before sharing or deploying

- **`.env.example` contains what look like real keys** — line 18 `APIFY_TOKEN` (`apify_api_…`) and line 20
  `YOUTUBE_API_KEY` (`AIza…`). Rotate both, keep them only in `/opt/dgipr/deploy/app.env`, put placeholders here.
- A read-only malware audit of this copy (PolinRider npm IOCs) came back **clean**: no IOCs, lockfile all
  registry.npmjs.org with integrity hashes, no install scripts beyond `fsevents`. The sibling project was hit via stolen
  GitHub access — check 2FA / tokens before pushing.
- **The map geometry was missing from the repo.** `.gitignore` had `data/`, which also matched
  `frontend/src/data/`, so `maharashtra-geometry.json` was never committed and a fresh clone could not build. Restored
  (recovered from the built bundle, 36 districts, identical data) and the rule changed to `/data/`. **Commit
  `frontend/src/data/maharashtra-geometry.json`.**

## Backend (`app/`)

| What | Where |
|---|---|
| `service.set_field()` — state office saves **one field's figure and/or its whole proof list in one transaction**, on any period. The figure goes through `correct()` (so an unsent period becomes sent by the state office, as before); proof goes through the same `_proof_plan` / `_apply_proofs` rules as `save()` (link checks, either ≤ number, links = number). A refused proof rolls back the figure too. | `app/forms/service.py` |
| `service.check_state_target()` — the recipient / period-start / not-future checks pulled out of `_entry_target()` (no behaviour change). | `app/forms/service.py` |
| `POST /api/forms/{id}/submissions/{office}/{period}/field` (state only) — body `{key, value?, note, proofs?}`; `value` left out = figure unchanged. | `app/web/forms_api.py` |
| **Upload permission:** `POST …/uploads` now lets the **state** role upload on a period that is already submitted (it was blocked by `check_writable`, so the state office could never attach proof after a day was sent). Districts/zones unchanged. | `app/web/forms_api.py` |
| `insights.posts()` + `GET /api/forms/{id}/analytics/posts` — every live proof item (link or file) on counted periods in the range, newest first, with office/field/day, plus per field: figures reported vs links/files given. Scoped like every other analytics call. | `app/forms/insights.py`, `app/web/forms_api.py` |
| Test `test_state_fills_a_missing_day_with_proof` (figure on an unsent day, links must match, PDF after sent, refused proof keeps the old figure, district gets 403, posts endpoint). | `tests/test_form_proofs.py` |

## Frontend (`frontend/src/`)

**Bug fixes**
- **Crash when the page is translated** (Chrome / Google Translate, phones too): edit a form → Discard showed the error
  page (`removeChild … not a child of this node`). Reproduced on the old build by simulating the translator. Fix:
  `lib/translateGuard.ts`, the standard guard for React issue #11538, installed in `main.tsx` before render.
- **No error boundary** — any render error gave a blank page. Added a route `errorElement` (`main.tsx`): plain message,
  Reload and Back, error logged to the console.
- **Copy for WhatsApp failed on phones over http** (clipboard API needs a secure context). `copyText()` now falls back
  to select-and-copy, and if that fails too, shows the text in a sheet with a WhatsApp button. (`pages/office/shared.tsx`)

**Responses — entering figures an office sent on WhatsApp** (`pages/forms/Responses.tsx`)
- Clicking any cell opens **one scrolling sheet with every field of that office-day** (replaces the one-value sheet),
  scrolled to and focused on the clicked field. Each field: value, note, **proof (paste links / upload PDF-photo)**,
  history, and its **own Save**; footer **Save all (n)**. Uses the new `/field` endpoint. Unsent days show a note that
  saved figures count as sent by the state office. Number validation shared with the fill page (`problemOf`, exported
  from `FillForm.tsx`).

**Desk / Forms / builder**
- **Form numbers**: blue "Form 1 / फॉर्म १" badge on Desk cards, Forms cards, Responses sections and the Fill picker.
  Stable everywhere: order of creation (id), archived forms counted, so numbers never shift (`useFormNumbers`,
  `FormNumber` in `pages/forms/common.tsx`).
- Desk: **New form** button; clicking a form's **title expands/collapses** the card; while searching, **Back (All forms)**
  under the search box (shared `DeskSearch`, so also on Forms and My forms).
- **Fill response** button beside New form (Desk, Forms) and on each live form card → pick a form → its fill page.
- Form builder: **Back (Forms)** button instead of the small "Forms ›" link; **Undo, one step at a time** in the footer
  (typing in one box = one step, a drag = one step, cleared on save; Discard is itself undoable).

**Analytics** — four tabs, all real data from the forms (no mock data on screen)
- Sidebar: **Monitoring hidden** (`SHOW_MONITORING = false` in `components/Layout.tsx`; pages still open by URL);
  **Analytics always shown** to state and zone: Overview · Form analytics · Districts · Posts. Shared tab bar + filters
  (form, dates, division, kept in the URL) in `pages/insights/shell.tsx`.
- **Overview** (`pages/insights/Overview.tsx`, rewritten): 4 big numbers (total publicity with change, offices
  reported, not reported, things to check), brief, totals by medium, daily trend, top 5 per reported day, 5 reporting
  least. Uses existing endpoints (summary, attention, groups, series, map).
- **Form analytics**: the existing `/office/form-analytics` page (was not linked from any menu), now with the tab bar.
- **Districts** (rewritten): map + one sortable, searchable table of every office (reported %, total, per day,
  change, latest day) from `analytics/map`.
- **Posts** (rewritten): per field reported vs links/files, then every proof item by day, each opening the post/file;
  from the new `analytics/posts`. No views/likes — those would need Social Monitoring, which is off.
- `/insights/posts/:id` now redirects to Posts (it only ever showed sample posts).
- **WhatsApp share**: green "WhatsApp वर पाठवा" (`wa.me/?text=…`) beside the copy buttons on the brief, the Desk and
  Compliance (`WhatsAppButton` / `CopyButton whatsapp`).
- `pages/insights/sample.ts`, `kit.tsx` and `img/` are **no longer imported** (not in the bundle). Left in place;
  safe to delete.

**Strings**: all new UI text is in `lib/i18n.tsx`, Marathi first and English.

## Not done / open

- A white screen on the form builder reported in round 1 could not be reproduced without translation; it is almost
  certainly the translation crash above (the tester was translating), now fixed and covered by the error screen.
- Analytics shows no post *performance* (views, likes) — needs post metrics stored over time, which needs Monitoring.
- Zone users get form numbers from their own form list, so a zone's "Form 3" can differ from the state's.
- Live link checks (green ticks) are not shown in the Responses sheet; the server still checks on Save and shows the
  reason under the field.

## Files touched

Backend: `app/forms/service.py`, `app/forms/insights.py`, `app/web/forms_api.py`, `tests/test_form_proofs.py`.
Frontend: `main.tsx`, `lib/i18n.tsx`, `lib/api.ts`, **new** `lib/translateGuard.ts`, `components/Layout.tsx`,
`components/analytics/BriefCard.tsx`, `pages/office/{Desk,shared,Analytics,Compliance}.tsx`,
`pages/forms/{Responses,FormBuilder,FormsList,FillForm,common}.tsx`, `pages/insights/{Overview,Districts,Posts,Post}.tsx`,
**new** `pages/insights/shell.tsx`, **restored** `data/maharashtra-geometry.json`.
Other: `.gitignore` (`data/` → `/data/`), `app/web/spa/` (rebuilt), this file.
