# Expense Tracker

A single-page expense tracker that stores its data in **`data/expenses.xlsx`** in this
repository. Add, edit, and delete expenses from the deployed page — each change is
written into the workbook and committed through the GitHub API. No server, no database,
no build step.

```
browser  ──①  read  ──▶  GitHub Contents API  ──▶  data/expenses.xlsx
   │                                                      │
   └──② edit in memory ──▶ ③ PUT (commit) ────────────────┘
                                     │
                                     └──▶ Pages workflow republishes the site
```

## Setup

**1 · Push this code**

```bash
git add -A && git commit -m "Add expense tracker" && git push origin main
```

**2 · Turn on Pages** — *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
Then run the *Deploy to GitHub Pages* workflow (it also runs on every push to `main`).
The URL is `https://<owner>.github.io/<repo>/`.

> Pages on a **private** repository requires GitHub Pro or higher. On the free plan the
> repository must be public for Pages to publish — see [Privacy](#privacy) before doing that.

**3 · Create a token** — [Settings → Developer settings → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new):

| Field | Value |
|---|---|
| Repository access | *Only select repositories* → this repository |
| Permissions | **Contents: Read and write** |
| Expiration | your call — the app tells you when it expires |

**4 · Open the URL, click ⚙, paste the token.** It is verified, then kept in this
browser's `localStorage` and sent only to `api.github.com`. It is never committed.
Repeat on each device you use.

## Using it

| | |
|---|---|
| **Add** | *＋ Add expense*, or press <kbd>N</kbd> |
| **Edit / delete** | ✎ and 🗑 on any row |
| **Filter** | month, category, or free-text search; click a category bar to filter by it |
| **Sort** | click the *Date* or *Amount* header |
| **Excel copy** | *↓ Excel* downloads the workbook as it currently stands |
| **Status** | the pill in the header — click it to retry a failed save or reload |

Edits appear immediately and commit in the background. If two devices edit at once, the
save re-reads the file, replays your change onto the latest version, and commits — so a
concurrent edit is merged rather than clobbered.

## The workbook

Sheet **`Expenses`**, one row per expense:

| ID | Date | Category | Description | Amount | Payment Method | Notes |
|---|---|---|---|---|---|---|
| `a1b2c3d4` | 2026-07-31 | Food & Dining | Team lunch | 1249.50 | UPI | — |

`Date` is a real Excel date (`yyyy-mm-dd`) and `Amount` a real number (`#,##0.00`), so
sorting, filtering, and pivots work if you open the file in Excel directly. Rows are kept
sorted by date, and `ID` is what the app matches on — **don't edit the ID column**. Editing
the file by hand in Excel is fine; commit it and the app picks it up. Extra columns you add
are not preserved when the app next writes the file.

## Privacy

The published Pages site is reachable by anyone who knows the URL, even when the
repository is private (access-controlled Pages is an Enterprise feature). So the deploy
workflow **excludes `data/` from the published site**: the page ships as an empty shell and
the workbook is fetched through the API with your token. Without a token a visitor sees
nothing.

To publish the workbook with the site as well — anonymous read-only viewing, no token
needed — set a repository variable `PUBLISH_DATA` to `true`
(*Settings → Secrets and variables → Actions → Variables*). **Only do this if you're
comfortable with the file being downloadable by anyone with the URL.**

A `secret_scanning` alert on your own token is worth noting: never paste the token into a
file in this repo, only into the app's Settings dialog.

## Configuration

`assets/config.js` — `owner` and `repo` are auto-detected from the Pages URL, so you only
set them if you serve the app from a custom domain or open it over `file://`.

```js
window.EXPENSE_CONFIG = {
  branch: 'main',
  filePath: 'data/expenses.xlsx',
  sheetName: 'Expenses',
  locale: 'en-IN',
  currency: 'INR',
  categories: [...],   // choices in the Add/Edit dropdown
  methods: [...],
};
```

Currency and locale can also be changed at runtime in the Settings dialog (stored
per-browser).

## Layout

```
index.html                  markup
assets/styles.css           design tokens, light + dark
assets/app.js               state, xlsx ↔ rows, GitHub API, commit queue, rendering
assets/config.js            your settings
assets/vendor/xlsx.full.min.js   SheetJS 0.18.5, vendored — no CDN, no npm install
data/expenses.xlsx          your data
.github/workflows/deploy.yml     Pages deploy
```

## Notes and limits

- Every change is one commit, so the history is a full audit trail — and `main` will have a
  lot of commits.
- Each commit triggers a Pages deploy (~1 min). Your own view updates instantly because it
  reads through the API, not from the published copy.
- The GitHub API allows 5,000 authenticated requests/hour; each save uses two.
- Amounts are stored to 2 decimal places in a single currency — there's no FX conversion.
- Local development: `python -m http.server` from the repo root, then set `owner`/`repo` in
  `assets/config.js` (auto-detection only works on a `github.io` host).
