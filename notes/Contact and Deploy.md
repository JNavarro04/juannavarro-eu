---
tags: [deploy, infrastructure]
---

# Contact and Deploy

## Where it lives

- **Repo** — `JNavarro04/juannavarro-eu` (private)
- **Host** — Vercel project **`photography-website-sazl`**
- **Domain** — `www.juannavarro.eu`, apex redirects to www
- **DNS** — GoDaddy, third-party nameservers, **never touched**

Changing the site is a code deploy, not a DNS change. That is why swapping the
repo on the *existing* project was the right move: domain and SSL stay attached.

There is a second project, `photography-website`, which serves nothing. Safe to
delete.

## Deploys go straight to production

Pushing to `main` deploys to production immediately — there is no preview step to
approve first. **Instant Rollback** on the project Overview is the safety net.

## The contact form

`api/contact.ts` is a **Vercel Edge Function** relaying to Resend.

Deliberately server-side: a client-side form endpoint (Formspree et al.) ships
its token in public JavaScript where it can be scraped. This cannot.

It validates input, strips control characters to block header injection, escapes
HTML, and answers the honeypot with 200 so bots learn nothing.

## Environment variables

| Name | Value | Type |
|---|---|---|
| `RESEND_API_KEY` | `re_…` | **Secret** — server-side only |
| `VITE_CONTACT_ENDPOINT` | `/api/contact` | **Config** — public |

**Anything prefixed `VITE_` is inlined into the browser bundle and is public.**
Vercel enforces this and will refuse to mark such a variable Secret. It is exactly
why the form posts to `/api/contact` instead of calling Resend from the browser.

Env vars are **not applied to existing builds** — always redeploy after changing
them. Especially `VITE_` ones, which are baked in at build time.

## vercel.json

- SPA rewrite `/((?!api/).*) → /index.html` so `/info` survives a hard refresh.
  **The `/api` exclusion is essential** — without it the catch-all swallows the
  contact function.
- Immutable cache headers for `/p/*` and `/assets/*`.

## Verifying a deploy without sending mail

```
GET  /api/contact          → 405   (404 would mean the function is missing)
POST bad payload           → 400 with a validation message
```

Related: [[Asset Pipeline]] · [[Gotchas]]
