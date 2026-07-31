# Expense Tracker

A single-page expense tracker whose data is an Excel file in this repository. Add, edit,
and delete expenses from the deployed page — each change is written into the workbook and
committed through the GitHub API. No server, no database, no build step.

**Live:** https://asif-nice.github.io/poc-track-expenses/

```
browser ──① GET  data/expenses.xlsx        (published with the site, no token needed)
   │
   ├──② edit in memory
   └──③ PUT /repos/<owner>/<repo>/contents/data/expenses.xlsx
                with the current sha + Bearer <your token>  ──▶  one commit per change
                                                                       │
                                                        Pages workflow republishes
```

Reading is anonymous. Writing needs a token, entered once per browser.

## Setup

**1 · Create a token** — [Settings → Developer settings → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new):

| Field | Value |
|---|---|
| Repository access | *Only select repositories* → this repository |
| Permissions | **Contents: Read and write** |
| Expiration | your call — GitHub emails you before it lapses |

**2 · Open the site, click ⚙, paste the token, save.** It is verified, then kept in that
browser's `localStorage` and sent only to `api.github.com`. It is never committed. Repeat
once per device.

Pages is already enabled (*Settings → Pages → Source: GitHub Actions*) and the workflow
runs on every push to `main`.

## Using it

| | |
|---|---|
| **Add** | *＋ Add expense*, or press <kbd>N</kbd> |
| **Edit / delete** | ✎ and 🗑 on any row |
| **Filter** | month, category, or free-text search; click a category bar to filter by it |
| **Sort** | click the *Date* or *Amount* header |
| **Excel copy** | *↓ Excel* downloads the workbook as it currently stands |
| **Status** | the pill in the header — click to retry a failed save or reload |

Edits show immediately and commit in the background. If two devices edit at once, the save
re-reads the file, replays your change onto the latest version, and commits — so a
concurrent edit merges rather than clobbers. Close the tab with a save still in flight and
the browser warns you.

With a token the app reads through the API, so your own view is always current. Without
one it reads the published copy, which lags a change by however long the deploy takes
(~1 min).

## The workbook

`data/expenses.xlsx`, sheet **`Expenses`**, one row per expense:

| ID | Date | Category | Description | Amount | Payment Method | Notes |
|---|---|---|---|---|---|---|
| `a1b2c3d4` | 2026-07-31 | Food & Dining | Team lunch | 1249.50 | UPI | — |

`Date` is a real Excel date (`yyyy-mm-dd`) and `Amount` a real number (`#,##0.00`), so
sorting, filtering, and pivot tables work if you open the file in Excel. Rows are stored
sorted by date, and `ID` is what the app matches on — **don't edit the ID column**. Editing
the file by hand and committing it is fine; the app picks it up. Extra columns you add are
not preserved the next time the app writes the file.

## Privacy

**This repository is public, so `data/expenses.xlsx` is readable by anyone** — directly from
the repo and from the published site. That is a deliberate POC trade-off: GitHub Pages
cannot publish from a private repository on the free plan.

Two ways to change that if this stops being a POC:

- **GitHub Pro** (~$4/month) — keep the repo private and Pages still publishes. Note the
  Pages *site* stays reachable by URL regardless; to keep the data off it, drop `data/`
  from the artifact in `deploy.yml` and let the app read through the API with your token.
- **Split repos** — public repo for the app, private repo for the workbook; point
  `owner`/`repo` in `assets/config.js` at the private one. Free, and the data never
  touches the public site.

## Deployment

`.github/workflows/deploy.yml` publishes this repo to Pages via `actions/deploy-pages`, on
every push to `main` and on demand (*Actions → Deploy to GitHub Pages → Run workflow*).
There is no build step — the artifact is the repo as-is.

Every expense edit is a commit, so every edit triggers a deploy. Runs supersede each other
(`cancel-in-progress`), so a burst of edits collapses into one publish.

## Configuration

`assets/config.js`:

```js
window.EXPENSE_CONFIG = {
  owner: null,          // null → detected from the Pages URL
  repo: null,           // null → detected from the Pages URL
  branch: 'main',
  filePath: 'data/expenses.xlsx',
  sheetName: 'Expenses',
  locale: 'en-IN',
  currency: 'INR',
  categories: [...],    // Add/Edit dropdown choices
  methods: [...],
};
```

Currency and locale can also be changed at runtime in Settings (stored per browser).

## Layout

```
index.html                       markup
assets/styles.css                design tokens, light + dark
assets/app.js                    state, xlsx ↔ rows, GitHub API, commit queue, rendering
assets/config.js                 your settings
assets/vendor/xlsx.full.min.js   SheetJS 0.18.5, vendored — no CDN, no npm install
data/expenses.xlsx               your data
.github/workflows/deploy.yml     Pages deploy
```

## Notes and limits

- One commit per change, so `main`'s history is a full audit trail — and it grows a commit
  per expense.
- The GitHub API allows 5,000 authenticated requests/hour; each save uses two.
- Amounts are stored to 2 decimals in a single currency — no FX conversion.
- A token in `localStorage` is readable by anything that can run script on this origin.
  Scope it to this one repo and revoke it if a device is lost.
- Local development: `python -m http.server` from the repo root, then visit
  `http://localhost:8000` and set `owner`/`repo` in `assets/config.js` (auto-detection
  needs a `github.io` host).
