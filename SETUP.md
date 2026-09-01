# Setup

## Running locally

```bash
npm install
npm run dev
```

The photo derivatives and atlases are generated, not committed. If `public/p/`
is missing (fresh clone), rebuild it from `photos-src/`:

```bash
npm run assets
```

That takes ~3 minutes for 162 photos and writes `public/p/**` plus
`src/data/photos.json`.

---

## Making the contact form actually send email

The site is static, so it cannot send mail on its own. `api/contact.ts` is a
Vercel Edge Function that relays the form to your inbox. It needs one secret,
which **you** have to create — I can't make accounts on your behalf.

### Steps

1. Go to <https://resend.com> and sign up (free tier: 3,000 emails/month,
   100/day — far more than a portfolio needs).
2. Create an API key: **API Keys → Create API Key**, permission "Sending access".
   Copy it; it is shown once and starts with `re_`.
3. In your Vercel project: **Settings → Environment Variables**, add:

   | Name | Value | Environments |
   | --- | --- | --- |
   | `RESEND_API_KEY` | the `re_...` key | Production, Preview, Development |
   | `VITE_CONTACT_ENDPOINT` | `/api/contact` | Production, Preview |

   Both are required. `RESEND_API_KEY` is read server-side by the function;
   `VITE_CONTACT_ENDPOINT` is baked into the client at build time and tells the
   form where to POST. Leave `VITE_CONTACT_ENDPOINT` unset locally — `vite dev`
   does not run Vercel functions, so the form correctly falls back to mailto.

4. Redeploy. The form is live.

### Optional variables

| Name | Default | Why change it |
| --- | --- | --- |
| `CONTACT_TO` | `navarro.frames@gmail.com` | Send enquiries somewhere else |
| `CONTACT_FROM` | `Portfolio <onboarding@resend.dev>` | Use your own domain — see below |

### Sending from your own domain (recommended, not required)

Out of the box, mail is sent from Resend's shared `onboarding@resend.dev`. It
works immediately but is more likely to land in spam. To send as
`hello@juannavarro.eu`:

1. Resend → **Domains → Add Domain** → `juannavarro.eu`.
2. Add the DNS records it gives you (SPF + DKIM) at your domain registrar.
3. Once verified, set `CONTACT_FROM` to `Juan Navarro <hello@juannavarro.eu>`.

`reply_to` is always set to the sender's address, so replying from your inbox
goes straight back to whoever wrote in.

### Behaviour when the key is absent

Nothing breaks and nothing silently disappears. The endpoint returns a clear
503 and the form falls back to opening a pre-filled `mailto:` — so the site is
fully usable before you finish the steps above.

---

## Deploying

Vercel, zero config. `vercel.json` handles:

- SPA rewrites, so `/info` and `/contact` survive a hard refresh
- an `/api` exclusion so the catch-all cannot swallow the contact function
- immutable cache headers for `/p/*` and `/assets/*`

`photos-src/` (1.2 GB of originals) is gitignored and never deployed.
