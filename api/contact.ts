/**
 * POST /api/contact — relays the contact form to Juan's inbox.
 *
 * Runs as a Vercel Serverless Function so the provider key stays server-side.
 * A client-side form endpoint (Formspree et al.) ships its token in public JS,
 * where it can be scraped and abused; this cannot.
 *
 * Required env var (set in Vercel -> Settings -> Environment Variables):
 *   RESEND_API_KEY   — from https://resend.com
 * Optional:
 *   CONTACT_TO       — destination inbox (defaults to navarro.frames@gmail.com)
 *   CONTACT_FROM     — verified sender (defaults to Resend's shared onboarding domain)
 */

// Web-standard Request/Response signature: that is the Edge runtime contract.
// Without this, Vercel expects the Node (req, res) signature and the route 500s.
export const config = { runtime: 'edge' }

type Body = { name?: string; email?: string; message?: string; company?: string }

const TO = process.env.CONTACT_TO ?? 'navarro.frames@gmail.com'
const FROM = process.env.CONTACT_FROM ?? 'Portfolio <onboarding@resend.dev>'

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)

/** Strips control characters, which are how header-injection attempts arrive. */
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').trim()

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return Response.json({ error: 'Malformed request.' }, { status: 400 })
  }

  // Honeypot: real people leave this empty. Answer 200 so bots learn nothing.
  if (body.company && body.company.trim() !== '') {
    return Response.json({ ok: true })
  }

  const name = clean(body.name ?? '')
  const email = clean(body.email ?? '')
  const message = (body.message ?? '').trim()

  if (name.length < 2) return Response.json({ error: 'Please give your name.' }, { status: 400 })
  if (!isEmail(email)) {
    return Response.json({ error: 'That email address looks wrong.' }, { status: 400 })
  }
  if (message.length < 10) {
    return Response.json({ error: 'Please write a little more.' }, { status: 400 })
  }
  if (message.length > 5000) {
    return Response.json({ error: 'That message is too long.' }, { status: 400 })
  }

  const key = process.env.RESEND_API_KEY
  if (!key) {
    // Misconfiguration is the operator's problem, not the visitor's — say something
    // useful without disclosing which secret is missing.
    console.error('[contact] RESEND_API_KEY is not set; cannot deliver message.')
    return Response.json(
      { error: 'The contact form is not available right now. Please email directly.' },
      { status: 503 },
    )
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: email,
        subject: `Portfolio enquiry — ${name}`,
        text: `${name} <${email}>\n\n${message}`,
        html:
          `<p><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</p>` +
          `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
      }),
    })

    if (!res.ok) {
      console.error('[contact] provider rejected the send:', res.status, await res.text())
      return Response.json(
        { error: 'Could not send that. Please try again shortly.' },
        { status: 502 },
      )
    }
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[contact] network failure:', err)
    return Response.json({ error: 'Could not send that. Please try again shortly.' }, { status: 502 })
  }
}
