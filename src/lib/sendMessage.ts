/* ---------------------------------------------------------------------------
   Contact delivery — provider agnostic.

   A static site cannot send mail. There are two honest paths:

     1. A form endpoint is configured (VITE_CONTACT_ENDPOINT). We POST JSON and
        trust a 2xx. Works with Formspree, Web3Forms, a Worker, a Netlify
        function — anything that accepts `{ name, email, message }`.

     2. Nothing is configured. We do NOT pretend to send. We hand the message
        to the visitor's own mail client, pre-filled, and the UI says so.

   The message body is never logged, never stored, never sent anywhere except
   the configured endpoint or the visitor's own mail client.
   --------------------------------------------------------------------------- */

import { SITE } from '../config/site'

declare global {
  interface ImportMetaEnv {
    /** Endpoint the contact form POSTs to. Unset = mailto fallback. */
    readonly VITE_CONTACT_ENDPOINT?: string
    /** Optional. Only Web3Forms needs this; sent as `access_key`. */
    readonly VITE_CONTACT_ACCESS_KEY?: string
  }
}

export type ContactPayload = {
  name: string
  email: string
  message: string
}

/**
 * `sent`    — the endpoint accepted it.
 * `handoff` — no endpoint configured; the visitor's mail client was opened
 *             with `href` pre-filled. Nothing has been delivered yet.
 * `failed`  — human-readable reason. Never a stack trace, never a raw body.
 */
export type SendOutcome =
  | { status: 'sent' }
  | { status: 'handoff'; href: string }
  | { status: 'failed'; message: string }

const trimmed = (value: string | undefined): string =>
  typeof value === 'string' ? value.trim() : ''

/** The configured endpoint, or '' when the form is running unconfigured. */
export const CONTACT_ENDPOINT: string = trimmed(import.meta.env.VITE_CONTACT_ENDPOINT)

const ACCESS_KEY: string = trimmed(import.meta.env.VITE_CONTACT_ACCESS_KEY)

/** False when the form will fall back to `mailto:` instead of posting. */
export const isContactConfigured: boolean = CONTACT_ENDPOINT.length > 0

const TIMEOUT_MS = 15_000

const DIRECT = 'write to me directly'

/** Plain-English failures. No status codes leaking as jargon, no stack traces. */
function describeStatus(code: number): string {
  if (code === 400 || code === 422) {
    return `That submission was rejected — check the email address you entered, or ${DIRECT}.`
  }
  if (code === 401 || code === 403) {
    return `The contact service isn’t accepting messages right now. Please ${DIRECT}.`
  }
  if (code === 404 || code === 410) {
    return `The contact service has moved. Please ${DIRECT}.`
  }
  if (code === 429) {
    return `That’s a few too many messages in a row. Wait a minute and try again.`
  }
  if (code >= 500) {
    return `The contact service is having a moment. Try again shortly, or ${DIRECT}.`
  }
  return `That didn’t go through. Try again, or ${DIRECT}.`
}

/** A pre-filled message in the visitor's own mail client. */
export function mailtoHref(payload: ContactPayload): string {
  const name = payload.name.trim()
  const subject = name ? `Hello from the website — ${name}` : 'Hello from the website'
  const body = `${payload.message.trim()}\n\n— ${name}\n${payload.email.trim()}\n`
  return `mailto:${SITE.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/**
 * Deliver a message. Resolves — it never throws, so the UI always has
 * something legible to render.
 *
 * @param signal aborts the request when the dialog unmounts mid-flight.
 */
export async function sendMessage(
  payload: ContactPayload,
  signal?: AbortSignal,
): Promise<SendOutcome> {
  const body: ContactPayload & { access_key?: string } = {
    name: payload.name.trim(),
    email: payload.email.trim(),
    message: payload.message.trim(),
  }

  if (!isContactConfigured) {
    const href = mailtoHref(body)
    // Synchronous, so it still counts as a user gesture and mail clients open.
    window.location.href = href
    return { status: 'handoff', href }
  }

  if (ACCESS_KEY) body.access_key = ACCESS_KEY

  const controller = new AbortController()
  const timedOut = { value: false }
  const timer = window.setTimeout(() => {
    timedOut.value = true
    controller.abort()
  }, TIMEOUT_MS)
  const relay = () => controller.abort()
  signal?.addEventListener('abort', relay)

  try {
    const response = await fetch(CONTACT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (response.ok) return { status: 'sent' }
    return { status: 'failed', message: describeStatus(response.status) }
  } catch {
    // Deliberately opaque: the caught value can contain the request payload.
    if (timedOut.value) {
      return {
        status: 'failed',
        message: `That took too long to send. Check your connection and try again, or ${DIRECT}.`,
      }
    }
    if (signal?.aborted) {
      return { status: 'failed', message: 'Sending was cancelled.' }
    }
    return {
      status: 'failed',
      message: `That didn’t reach me — you may be offline. Try again, or ${DIRECT}.`,
    }
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', relay)
  }
}
