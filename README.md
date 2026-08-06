# Wedding Budget

A single-page wedding budget tracker whose data is an Excel file in this repository. Record
what each part of the wedding is expected to cost, then record every payment against it —
including **who in the family paid**. Each change is written into the workbook and committed
through the GitHub API. No server, no database, no build step.

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

## The model

Two things, kept on two sheets:

| | |
|---|---|
| **Budget item** | something the wedding needs, and what it is expected to cost — *Catering — dinner, ₹5,00,000* |
| **Payment** | money actually handed over, against one item, by one named person — *₹50,000 by Ramesh (father) on 20 Apr* |

Several people can pay towards the same item, and one person can pay towards many. That
split is the point: the app is built to answer *"catering is ₹5 L, we've paid ₹2.1 L — and
who put that in?"* at a glance.

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
| **Add a budget item** | *＋ Budget item*, or press <kbd>B</kbd>. Starting fresh, the empty state offers a typical set of ~15 items in one click |
| **Record a payment** | *＋ Payment*, press <kbd>N</kbd>, the ₹ button on any item row, or click that item's bar in the chart |
| **Edit / delete** | ✎ and 🗑 on any row. Deleting an item removes its payments too, and says so first |
| **See an item's payments** | ▸ on its row in the *Budget items* table |
| **Filter** | category, person, or free-text search — one row at the top that scopes every chart and both tables. Clicking a person's bar filters by them |
| **Sort** | click any *Item*, *Estimated*, *Paid*, *Still to pay*, *Date*, or *Amount* header |
| **Excel copy** | *↓ Excel* downloads the workbook as it currently stands |
| **Status** | the pill in the header — click to retry a failed save or reload |

Filtering by a person narrows the *payments*, never the budgets, so the page then reads as
"what has Ramesh covered" — the headline relabels itself to say so.

Edits show immediately and commit in the background. If two devices edit at once, the save
re-reads the file, replays your change onto the latest version, and commits — so a
concurrent edit merges rather than clobbers. Close the tab with a save still in flight and
the browser warns you.

With a token the app reads through the API, so your own view is always current. Without one
it reads the published copy, which lags a change by however long the deploy takes (~1 min).

## The charts

Each view answers a different question, all drawn as plain SVG against the same filtered
slice:

| View | Question it answers |
|---|---|
| Hero + meter | how far through the whole budget are we? |
| Highlight tiles | biggest remaining gap, top contributor, how many items are settled, latest payment |
| **Budget vs paid, by item** | which items are funded and which are lagging — track length is the estimate, fill is what is paid, red when it has gone over |
| **Who has contributed** | how much each person has put in, ranked |
| **Funding over time** | cumulative payments against the total-budget line — are we on track? |
| **Who paid for what** | a person × item grid; darker means more money |

Colour carries exactly one meaning throughout — *how much money* — on a single blue ramp.

The who-paid-for-what grid was first drawn as a stacked bar with a hue per person, and that
was wrong: different items draw different subsets of payers, so any two people can end up
touching, which is the all-pairs colour case. Only four of the reference palette's hues
clear it in both light and dark, and folding the fifth relative into grey would discard
exactly what this app exists to record. A grid of magnitudes takes a heatmap on one
sequential hue instead — identity comes from the row and column labels, so any number of
family members fit. Every chart also has a table twin below it, keyboard-reachable
tooltips, and light and dark steps chosen for their own surface rather than flipped.

## The workbook

`data/expenses.xlsx` has three sheets. The first two are the data; the third is generated
for you and never read back.

**Budget**

| ID | Item | Category | Estimated | Notes |
|---|---|---|---|---|
| `i7f2a4b1` | Catering — dinner | Food & Catering | 500000.00 | 400 guests |

**Payments**

| ID | Item ID | Item | Date | Amount | Paid By | Payment Method | Notes |
|---|---|---|---|---|---|---|---|
| `p3c9d0e5` | `i7f2a4b1` | Catering — dinner | 2026-04-20 | 50000.00 | Ramesh (father) | UPI | Advance |

`Date` is a real Excel date (`yyyy-mm-dd`) and the money columns are real numbers
(`#,##0.00`), so sorting, filtering, and pivot tables work if you open the file in Excel.
`Item` is carried alongside `Item ID` so the sheet reads on its own.

A payment is matched by `Item ID` first, then by item name — so you can type a row straight
into Excel with just the name, and an unrecognised name creates that item rather than
dropping the row. **Don't edit the ID columns**; they are what the app matches on. Extra
columns you add are not preserved the next time the app writes the file.

**Summary** — one row per item with live `SUMIF` formulas for paid and still-to-pay, plus a
total row. Cached values are written alongside each formula, so the numbers are right
whether or not the reader evaluates formulas.

If the file still holds the flat `Expenses` sheet from the earlier version of this app, it
is migrated on read: each old row becomes a payment against an item named for its category,
with the payer recorded as *Unrecorded*. Nothing is dropped. That conversion is written back
the first time you save.

## Privacy

**This repository is public, so `data/expenses.xlsx` is readable by anyone** — directly from
the repo and from the published site. For a wedding budget that means family members' names
and what each of them paid. Consider that before entering real figures.

Two ways to change it:

- **Split repos** — public repo for the app, private repo for the workbook; point
  `owner`/`repo` in `assets/config.js` at the private one. Free, and the data never touches
  the public site. This is the recommended option.
- **GitHub Pro** (~$4/month) — keep the repo private and Pages still publishes. Note the
  Pages *site* stays reachable by URL regardless; to keep the data off it, drop `data/` from
  the artifact in `deploy.yml` and let the app read through the API with your token.

## Deployment

`.github/workflows/deploy.yml` publishes this repo to Pages via `actions/deploy-pages`, on
every push to `main` and on demand (*Actions → Deploy to GitHub Pages → Run workflow*).
There is no build step — the artifact is the repo as-is.

Every edit is a commit, so every edit triggers a deploy. Runs supersede each other
(`cancel-in-progress`), so a burst of edits collapses into one publish.

## Configuration

`assets/config.js`:

```js
window.EXPENSE_CONFIG = {
  owner: null,          // null → detected from the Pages URL
  repo: null,           // null → detected from the Pages URL
  branch: 'main',
  filePath: 'data/expenses.xlsx',
  budgetSheet: 'Budget',
  paymentSheet: 'Payments',
  locale: 'en-IN',
  currency: 'INR',
  categories: [...],    // groups a budget item can belong to
  payers: [],           // seeds the "Paid by" suggestions; any name typed is accepted
  methods: [...],
  starterItems: [...],  // the one-click typical plan offered from the empty state
};
```

Currency and locale can also be changed at runtime in Settings (stored per browser). With
`INR`, chart and tile figures are shortened the way people say them — ₹5 L, ₹1.2 Cr.

## Layout

```
index.html                       markup
assets/styles.css                design tokens, light + dark
assets/app.js                    state, xlsx ↔ rows, GitHub API, commit queue, charts, rendering
assets/config.js                 your settings
assets/vendor/xlsx.full.min.js   SheetJS 0.18.5, vendored — no CDN, no npm install
data/expenses.xlsx               your data
.github/workflows/deploy.yml     Pages deploy
```

## Notes and limits

- One commit per change, so `main`'s history is a full audit trail — and it grows a commit
  per payment.
- The GitHub API allows 5,000 authenticated requests/hour; each save uses two.
- Amounts are stored to 2 decimals in a single currency — no FX conversion.
- A person is identified by the name you type. Two spellings are two people; the *Paid by*
  field suggests names already used, which is what keeps them consistent.
- A token in `localStorage` is readable by anything that can run script on this origin.
  Scope it to this one repo and revoke it if a device is lost.
- Local development: `python -m http.server` from the repo root, then visit
  `http://localhost:8000` and set `owner`/`repo` in `assets/config.js` (auto-detection
  needs a `github.io` host).
