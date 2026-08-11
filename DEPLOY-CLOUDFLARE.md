# Hosting this on Cloudflare Pages

Gives a URL like `https://legendary-umbrella-qj3m23e.pages.dev` instead of
`https://asif-nice.github.io/poc-track-expenses/`. Free, and it redeploys on every push to
`main`, exactly like the GitHub Pages workflow does now.

The repo side is already done — `owner`/`repo` are named in `assets/config.js`, so the app
keeps talking to this repository from any address. The rest is clicking.

## What to do

**1 · Sign in** at <https://dash.cloudflare.com> (a free account is enough).

**2 · Workers & Pages → Create → Pages → Connect to Git.** Authorise Cloudflare for GitHub
and pick `Asif-Nice/poc-track-expenses`.

**3 · Name the project.** This *is* the URL — the site ends up at
`https://<project-name>.pages.dev`. Type whatever random-looking name you want, for example
`legendary-umbrella-qj3m23e`. Two things to know before you commit to it:

- Only lowercase letters, digits and hyphens.
- **The subdomain cannot be renamed later** — changing it means deleting the project and
  making a new one. So pick the name you actually want now.

**4 · Build settings — leave everything empty.** There is no build step; the repo is the
site.

| Field | Value |
|---|---|
| Framework preset | **None** |
| Build command | *(leave blank)* |
| Build output directory | `/` |
| Root directory | *(leave blank)* |

**5 · Save and Deploy.** It takes about a minute. Your site is then at
`https://<project-name>.pages.dev`.

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
