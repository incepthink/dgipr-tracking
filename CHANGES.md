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
