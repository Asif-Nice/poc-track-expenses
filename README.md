# Expense Tracker

A single-page expense tracker whose data is an Excel file in a Git repository. Add, edit,
and delete expenses from the deployed page — each change is written into the workbook and
committed through the GitHub API. No server, no database, no build step.

**Live:** https://asif-nice.github.io/poc-track-expenses/

## How it is split

Two repositories, because a GitHub Pages site is reachable by anyone with the URL:

| Repository | Visibility | Holds |
|---|---|---|
| [`poc-track-expenses`](https://github.com/Asif-Nice/poc-track-expenses) | **public** | the app — HTML, CSS, JS, deploy workflow |
| [`poc-track-expenses-data`](https://github.com/Asif-Nice/poc-track-expenses-data) | **private** | `data/expenses.xlsx` |

Nothing published to Pages contains expense data. The page loads the workbook at runtime
from the private repo using a token you paste in once, so an anonymous visitor gets an
empty app.

```
browser ──① GET  /repos/<owner>/poc-track-expenses-data/contents/data/expenses.xlsx
   │                                    (Bearer <your token>)
   ├──② edit in memory
   └──③ PUT same path, with sha ──▶ one commit per change
```

## Setup

**1 · Create a token** — [Settings → Developer settings → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new):

| Field | Value |
|---|---|
| Repository access | *Only select repositories* → **`poc-track-expenses-data`** |
| Permissions | **Contents: Read and write** |
| Expiration | your call — GitHub emails you before it lapses |

Scope it to the **data** repo, not the app repo. The app repo needs no token at all.

**2 · Open the site, click ⚙, paste the token, save.** It is verified against the repo,
then kept in that browser's `localStorage` and sent only to `api.github.com`. It is never
committed. Repeat once per device.

That's it — the deploy already ran when this repo was pushed.

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

## The workbook

Sheet **`Expenses`**, one row per expense:

| ID | Date | Category | Description | Amount | Payment Method | Notes |
|---|---|---|---|---|---|---|
| `a1b2c3d4` | 2026-07-31 | Food & Dining | Team lunch | 1249.50 | UPI | — |

`Date` is a real Excel date (`yyyy-mm-dd`) and `Amount` a real number (`#,##0.00`), so
sorting, filtering, and pivot tables work if you open the file in Excel. Rows are stored
sorted by date, and `ID` is what the app matches on — **don't edit the ID column**. Editing
the file by hand and committing it is fine; the app picks it up. Extra columns you add are
not preserved the next time the app writes the file.

## Deployment

`.github/workflows/deploy.yml` publishes this repo to Pages via `actions/deploy-pages`, on
every push to `main` and on demand (*Actions → Deploy to GitHub Pages → Run workflow*).
There is no build step — the artifact is the repo as-is.

Because expense edits commit to the **data** repo, normal use doesn't trigger a deploy;
only code changes do.

## Configuration

`assets/config.js`:

```js
window.EXPENSE_CONFIG = {
  owner: 'Asif-Nice',                 // where the workbook lives
  repo: 'poc-track-expenses-data',    // ← the private data repo
  branch: 'main',
  filePath: 'data/expenses.xlsx',
  sheetName: 'Expenses',
  locale: 'en-IN',
  currency: 'INR',
  categories: [...],   // Add/Edit dropdown choices
  methods: [...],
};
```

Set `owner`/`repo` to `null` to auto-detect them from the Pages URL instead — correct only
if you keep the data in the same repo as the app. Currency and locale can also be changed
at runtime in Settings (stored per browser).

## Layout

```
index.html                       markup
assets/styles.css                design tokens, light + dark
assets/app.js                    state, xlsx ↔ rows, GitHub API, commit queue, rendering
assets/config.js                 your settings
assets/vendor/xlsx.full.min.js   SheetJS 0.18.5, vendored — no CDN, no npm install
.github/workflows/deploy.yml     Pages deploy
```

## Notes and limits

- One commit per change, so the data repo's history is a full audit trail — and it grows a
  commit per expense.
- The GitHub API allows 5,000 authenticated requests/hour; each save uses two.
- Amounts are stored to 2 decimals in a single currency — no FX conversion.
- A token in `localStorage` is readable by anything that can run script on this origin.
  The origin serves only these files, but scope the token to the one repo (as above) and
  revoke it if a device is lost.
- Local development: `python -m http.server` from the repo root, then visit
  `http://localhost:8000`.
