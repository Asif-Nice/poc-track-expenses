# Hosting this on Cloudflare Pages

Gives `https://poc-track-expenses.pages.dev` instead of
`https://asif-nice.github.io/poc-track-expenses/` — the same name, without your username in
the address. Free, and it redeploys on every push to `main`, exactly like the GitHub Pages
workflow does now.

The repo side is already done — `owner`/`repo` are named in `assets/config.js`, so the app
keeps talking to this repository from any address. The rest is clicking.

## What to do

**1 · Sign in** at <https://dash.cloudflare.com> (a free account is enough).

**2 · Workers & Pages → Create → Pages → Connect to Git.** Authorise Cloudflare for GitHub
and pick `Asif-Nice/poc-track-expenses`.

**3 · Name the project `poc-track-expenses`.** This *is* the URL — the site ends up at
`https://<project-name>.pages.dev`. Cloudflare pre-fills the repository name, so this one
needs no typing at all.

**The subdomain cannot be renamed later** — changing it means deleting the project and
making a new one — so if you would rather the address described the app than the repo,
change it now. These were free when this was written (lowercase, digits and hyphens only;
Cloudflare tells you at once if a name has since gone):

| Name | URL |
|---|---|
| `poc-track-expenses` | `poc-track-expenses.pages.dev` — matches the repo, pre-filled |
| `our-wedding-budget` | `our-wedding-budget.pages.dev` — says what it is |
| `track-wedding-expenses` | `track-wedding-expenses.pages.dev` |
| `shaadi-budget` | `shaadi-budget.pages.dev` |
| `wedding-kharcha` | `wedding-kharcha.pages.dev` |

The plainer generic ones — `wedding-budget`, `wedding-budget-tracker`,
`wedding-expense-tracker` — are already taken by other people.

**4 · Build settings — leave everything empty.** There is no build step; the repo is the
site.

| Field | Value |
|---|---|
| Framework preset | **None** |
| Build command | *(leave blank)* |
| Build output directory | `/` |
| Root directory | *(leave blank)* |

**5 · Save and Deploy.** It takes about a minute. Your site is then at
`https://poc-track-expenses.pages.dev` (or whichever name you chose).

## After it is live

**Enter your GitHub token once on the new address.** Tokens live in `localStorage`, which is
per-origin, so the new URL starts out not knowing it — open ⚙ Settings and paste it in. Your
budget itself is untouched; it lives in the repo, not in the browser.

**Turning the old URL off** (optional). *Repo → Settings → Pages → Source → None*. Do this
only once the new URL works. You can also delete `.github/workflows/deploy.yml`, though
leaving it costs nothing and keeps the old address as a fallback.

## What this does and does not change

- **Does:** your username and the repo name stop appearing in the address.
- **Does not:** make the budget private. This repository is public, so `data/expenses.xlsx`
  — the names and the amounts — is still readable by anyone at
  `github.com/Asif-Nice/poc-track-expenses`, whatever the site address is. A random URL is
  obscurity, not privacy. See the Privacy section of `README.md` for the options that
  actually close that.
