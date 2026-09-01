import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, JSX, MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { SITE } from '../config/site'
import { isContactConfigured, mailtoHref, sendMessage } from '../lib/sendMessage'
import '../styles/contact.css'

export type ContactFormProps = {
  open: boolean
  onClose: () => void
}

type FieldName = 'name' | 'email' | 'message'
type Values = Record<FieldName, string>
type Errors = Partial<Record<FieldName, string>>
type Status = 'idle' | 'sending' | 'sent' | 'handoff' | 'failed'

const ORDER: readonly FieldName[] = ['name', 'email', 'message']
const EMPTY: Values = { name: '', email: '', message: '' }

/* Deliberately permissive: something@something.tld, no spaces. Anything
   stricter rejects real addresses, and the endpoint is the real arbiter. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Keep in step with the exit animation in contact.css. */
const EXIT_MS = 360
/** Idle → sending → sent, then the panel settles into the thank-you. */
const SEAL_MS = 620
const TEXTAREA_MAX = 260

const FOCUSABLE =
  'a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"])'

const reduced = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function validate(values: Values): Errors {
  const found: Errors = {}
  const name = values.name.trim()
  const email = values.email.trim()
  const message = values.message.trim()

  if (name.length === 0) found.name = 'Your name, please.'
  else if (name.length < 2) found.name = 'That needs at least two characters.'

  if (email.length === 0) found.email = 'An address, so I can reply.'
  else if (!EMAIL.test(email)) found.email = 'That address doesn’t look right.'

  if (message.length === 0) found.message = 'Tell me what you have in mind.'
  else if (message.length < 10) found.message = 'A few more words — ten characters or so.'

  return found
}

/**
 * Full-screen contact overlay.
 *
 * Controlled: the parent owns `open` and is told when to close. While `open`
 * is false the component renders nothing — apart from the moment between the
 * close request and the end of its exit animation.
 */
export default function ContactForm({ open, onClose }: ContactFormProps): JSX.Element | null {
  /* `closing` keeps the overlay mounted for the length of its exit animation
     after `open` goes false. Whether to render at all is derived, not stored. */
  const [closing, setClosing] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)

  const [values, setValues] = useState<Values>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [submitted, setSubmitted] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [failure, setFailure] = useState('')
  const [settled, setSettled] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  const uid = useId()
  const titleId = `${uid}-title`
  const ledeId = `${uid}-lede`
  const noteId = `${uid}-note`
  const alertId = `${uid}-alert`

  const rootRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef<HTMLDivElement>(null)
  const trapRef = useRef<HTMLInputElement>(null)
  const inputs = useRef<Partial<Record<FieldName, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const backdropPress = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const sealTimer = useRef<number | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      abortRef.current?.abort()
      if (sealTimer.current !== null) window.clearTimeout(sealTimer.current)
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    }
  }, [])

  /**
   * Speak to the live region. Emptying it first is what makes an identical
   * sentence — submitting the same empty form twice — announce a second time.
   */
  const announce = useCallback((text: string) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    setAnnouncement('')
    noticeTimer.current = window.setTimeout(() => {
      if (alive.current) setAnnouncement(text)
    }, 60)
  }, [])

  const requestClose = useCallback(() => {
    onClose()
  }, [onClose])

  /* --- mount / exit ------------------------------------------------------ */

  // Adjusted during render rather than in an effect: React re-runs this pass
  // before committing, so the overlay never paints in a stale state.
  if (open !== prevOpen) {
    setPrevOpen(open)
    setClosing(!open)
    if (open && (status === 'sent' || status === 'handoff')) {
      // A finished conversation starts over; an unsent draft is kept.
      setValues(EMPTY)
      setErrors({})
      setSubmitted(false)
      setStatus('idle')
      setFailure('')
      setSettled(false)
      setAnnouncement('')
    }
  }

  const visible = open || closing

  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => setClosing(false), reduced() ? 0 : EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [closing])

  /* --- body scroll lock -------------------------------------------------- */

  useEffect(() => {
    if (!visible) return
    const body = document.body
    const overflow = body.style.overflow
    const padding = body.style.paddingRight
    const bar = window.innerWidth - document.documentElement.clientWidth

    body.style.overflow = 'hidden'
    if (bar > 0) body.style.paddingRight = `${bar}px`

    return () => {
      body.style.overflow = overflow
      body.style.paddingRight = padding
    }
  }, [visible])

  /* --- the rest of the page goes inert ------------------------------------ */

  /*
   * aria-modal tells a screen reader to ignore everything outside the dialog;
   * inert makes it true for every input method. Declared above the focus
   * effect on purpose — cleanups run in declaration order, so the trigger is
   * interactive again by the time focus is handed back to it.
   */
  useEffect(() => {
    if (!visible) return
    const overlay = rootRef.current
    const silenced: HTMLElement[] = []

    for (const child of Array.from(document.body.children)) {
      if (child === overlay || !(child instanceof HTMLElement) || child.inert) continue
      child.inert = true
      silenced.push(child)
    }

    return () => {
      for (const el of silenced) el.inert = false
    }
  }, [visible])

  /* --- focus in, focus back ---------------------------------------------- */

  useEffect(() => {
    if (!visible) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // On touch, focusing a field would throw the keyboard up before the
    // visitor has read anything. Land on the dialog instead.
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const target = coarse ? dialogRef.current : (inputs.current.name ?? dialogRef.current)
    // preventScroll: the entrance animation is still running underneath.
    target?.focus({ preventScroll: true })

    return () => {
      opener?.focus()
    }
  }, [visible])

  /* --- focus trap + escape ----------------------------------------------- */

  useEffect(() => {
    if (!visible) return

    const focusable = (): HTMLElement[] => {
      const root = dialogRef.current
      if (!root) return []
      return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1 && el.offsetParent !== null,
      )
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        requestClose()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && dialogRef.current?.contains(active) === true

      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [visible, requestClose])

  /* --- keep the panel clear of the soft keyboard -------------------------- */

  useEffect(() => {
    if (!visible) return
    const root = rootRef.current
    const viewport = window.visualViewport
    if (!root || !viewport) return

    const apply = () => root.style.setProperty('--cf-h', `${viewport.height}px`)
    apply()
    viewport.addEventListener('resize', apply)
    return () => {
      viewport.removeEventListener('resize', apply)
      root.style.removeProperty('--cf-h')
    }
  }, [visible])

  /* --- the panel settles: take focus with it ------------------------------ */

  useEffect(() => {
    if (!settled) return
    doneRef.current?.focus()
  }, [settled])

  /* --- the textarea grows with its content -------------------------------- */

  const grow = useCallback(() => {
    const el = inputs.current.message
    if (!(el instanceof HTMLTextAreaElement)) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    if (!visible || settled) return
    grow()
  }, [visible, settled, values.message, grow])

  /* --- editing ------------------------------------------------------------ */

  const change = (field: FieldName) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = event.target.value
    setValues((current) => ({ ...current, [field]: next }))
    if (status === 'failed') setStatus('idle')
    // Only start correcting in real time once they have tried to send, so the
    // first pass through the form is never nagged at.
    if (submitted) {
      setErrors((current) => {
        const fresh = validate({ ...values, [field]: next })
        const merged: Errors = { ...current }
        if (fresh[field]) merged[field] = fresh[field]
        else delete merged[field]
        return merged
      })
    }
  }

  const settle = useCallback(() => {
    if (sealTimer.current !== null) window.clearTimeout(sealTimer.current)
    sealTimer.current = window.setTimeout(
      () => {
        if (alive.current) setSettled(true)
      },
      reduced() ? 0 : SEAL_MS,
    )
  }, [])

  const submit = async () => {
    if (status === 'sending' || status === 'sent' || status === 'handoff') return

    setSubmitted(true)
    const found = validate(values)
    setErrors(found)

    const firstBad = ORDER.find((field) => found[field])
    if (firstBad) {
      const count = ORDER.filter((field) => found[field]).length
      announce(
        `${count === 1 ? 'One field needs' : `${count} fields need`} attention. ${found[firstBad] ?? ''}`,
      )
      inputs.current[firstBad]?.focus()
      return
    }

    setFailure('')

    // The honeypot was filled, so this is not a person. Show the success it is
    // looking for and send absolutely nothing.
    if ((trapRef.current?.value ?? '') !== '') {
      setStatus('sent')
      settle()
      return
    }

    setStatus('sending')
    announce('Sending your message.')

    const controller = new AbortController()
    abortRef.current = controller
    const outcome = await sendMessage(values, controller.signal)
    abortRef.current = null
    if (!alive.current) return

    if (outcome.status === 'failed') {
      setStatus('failed')
      setFailure(outcome.message)
      announce(outcome.message)
      return
    }

    setStatus(outcome.status)
    announce(
      outcome.status === 'sent'
        ? 'Your message was sent.'
        : 'Your mail app has been opened with the message ready to send.',
    )
    settle()
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit()
  }

  /* --- backdrop ----------------------------------------------------------- */

  const onBackdropDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    backdropPress.current = event.target === event.currentTarget
    // Keep focus where it is if the press turns out not to be a dismissal.
    if (backdropPress.current) event.preventDefault()
  }

  const onBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const outside = backdropPress.current && event.target === event.currentTarget
    backdropPress.current = false
    if (outside) requestClose()
  }

  if (!visible) return null

  const done = status === 'sent' || status === 'handoff'
  const buttonState: 'idle' | 'sending' | 'sent' = status === 'sending' ? 'sending' : done ? 'sent' : 'idle'
  const busy = status === 'sending' || done
  const first = values.name.trim().split(/\s+/)[0] ?? ''

  const idleLabel = isContactConfigured ? 'Send message' : 'Open in mail app'
  const sentLabel = status === 'handoff' ? 'Handed over' : 'Sent'
  const buttonName =
    buttonState === 'sending'
      ? 'Sending your message'
      : buttonState === 'sent'
        ? sentLabel
        : idleLabel

  const describedBy = [!isContactConfigured ? noteId : null, failure ? alertId : null]
    .filter((id): id is string => id !== null)
    .join(' ')

  const field = (name: FieldName, index: number, label: string, rise: number) => {
    const id = `${uid}-${name}`
    const errorId = `${id}-error`
    const error = errors[name]
    const multiline = name === 'message'
    const shared = {
      id,
      name,
      className: 'cf__input',
      value: values[name],
      onChange: change(name),
      placeholder: ' ',
      'aria-invalid': error ? (true as const) : undefined,
      'aria-describedby': error ? errorId : undefined,
    }

    return (
      <div className={`cf__row cf__rise${error ? ' is-error' : ''}`} data-rise={rise}>
        <span className="cf__idx" aria-hidden="true">
          {String(index).padStart(2, '0')}
        </span>
        <div className="cf__field">
          {multiline ? (
            <textarea
              {...shared}
              ref={(el) => {
                inputs.current[name] = el
              }}
              rows={2}
              onInput={grow}
            />
          ) : (
            <input
              {...shared}
              ref={(el) => {
                inputs.current[name] = el
              }}
              type={name === 'email' ? 'email' : 'text'}
              autoComplete={name === 'email' ? 'email' : 'name'}
              inputMode={name === 'email' ? 'email' : undefined}
              spellCheck={false}
            />
          )}
          <label className="cf__label" htmlFor={id}>
            {label}
          </label>
          <span className="cf__rule" aria-hidden="true" />
        </div>
        {/* Outside .cf__field, or it would push the rule off the input. */}
        {error ? (
          <span className="cf__err" id={errorId}>
            {error}
          </span>
        ) : null}
      </div>
    )
  }

  return createPortal(
    <div className={`cf${closing ? ' is-closing' : ''}`} ref={rootRef}>
      <span className="cf__edge" aria-hidden="true" />

      <div className="cf__sheet">
        <div
          className="cf__scroll"
          onMouseDown={onBackdropDown}
          onClick={onBackdropClick}
        >
          <div
            className="cf__dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={ledeId}
            tabIndex={-1}
          >
            <div className="cf__bar">
              <p className="cf__eyebrow cf__rise" data-rise={1}>
                Contact
              </p>
              <button
                type="button"
                className="cf__close cf__rise"
                data-rise={2}
                onClick={requestClose}
              >
                Close
                <svg className="cf__closeGlyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <line x1="1" y1="1" x2="11" y2="11" />
                  <line x1="11" y1="1" x2="1" y2="11" />
                </svg>
                {/* Makes the accessible name read "Close contact form". */}
                <span className="cf__sr">{' contact form'}</span>
              </button>
            </div>

            <div className="cf__body">
              <div className="cf__intro">
                <h2 className="cf__title cf__rise" id={titleId} data-rise={3}>
                  <span className="cf__titleLayer" data-on={String(!settled)} aria-hidden={settled}>
                    Say hello.
                  </span>
                  <span className="cf__titleLayer" data-on={String(settled)} aria-hidden={!settled}>
                    {status === 'handoff' ? 'Ready to send.' : 'Message sent.'}
                  </span>
                </h2>
                <p className="cf__lede cf__rise" id={ledeId} data-rise={4}>
                  <span className="cf__ledeLayer" data-on={String(!settled)} aria-hidden={settled}>
                    Commissions, prints, or a question about a frame. Every message
                    comes straight to me, and I answer them myself.
                  </span>
                  <span className="cf__ledeLayer" data-on={String(settled)} aria-hidden={!settled}>
                    {status === 'handoff' ? (
                      <>
                        Your mail app should have opened with the message inside. Press
                        send there and it reaches me.
                      </>
                    ) : (
                      <>
                        Thank you{first ? `, ${first}` : ''}. It is in my inbox — I’ll
                        reply from {SITE.email}, usually within a couple of days.
                      </>
                    )}
                  </span>
                </p>
              </div>

              {settled ? (
                <div className="cf__done" ref={doneRef} tabIndex={-1}>
                  <svg
                    className="cf__mark"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <circle className="cf__markRing" cx="24" cy="24" r="22.5" />
                    <path className="cf__markTick" d="M14 24.5 L21 31.5 L34.5 17" />
                  </svg>

                  {status === 'handoff' ? (
                    <p className="cf__doneText cf__rise" data-settle={2}>
                      Nothing opened?{' '}
                      <a className="cf__doneLink" href={mailtoHref(values)}>
                        Open the message by hand
                      </a>
                      .
                    </p>
                  ) : null}

                  <button
                    type="button"
                    className="cf__send cf__doneClose cf__rise"
                    data-settle={3}
                    data-state="idle"
                    onClick={requestClose}
                  >
                    <span className="cf__sendFill" aria-hidden="true" />
                    <span className="cf__sendLabels">
                      <span className="cf__sendLabel" data-when="idle">
                        Close
                      </span>
                    </span>
                  </button>
                </div>
              ) : (
                <form
                  className="cf__form"
                  onSubmit={onSubmit}
                  noValidate
                  data-phase={done ? 'sealing' : 'editing'}
                >
                  {field('name', 1, 'Name', 5)}
                  {field('email', 2, 'Email', 6)}
                  {field('message', 3, 'Message', 7)}

                  {/* Honeypot. Never shown, never focusable, never submitted. */}
                  <div className="cf__trap" aria-hidden="true">
                    <label htmlFor={`${uid}-company`}>Company</label>
                    <input
                      id={`${uid}-company`}
                      name="company"
                      type="text"
                      ref={trapRef}
                      tabIndex={-1}
                      autoComplete="off"
                      defaultValue=""
                    />
                  </div>

                  <div className="cf__row cf__row--actions cf__rise" data-rise={8}>
                    <div className="cf__actions">
                      <button
                        type="submit"
                        className="cf__send"
                        data-state={buttonState}
                        aria-label={buttonName}
                        aria-disabled={busy || undefined}
                        aria-busy={status === 'sending' || undefined}
                        aria-describedby={describedBy || undefined}
                      >
                        <span className="cf__sendFill" aria-hidden="true" />
                        <span className="cf__sendLabels" aria-hidden="true">
                          <span className="cf__sendLabel" data-when="idle">
                            {idleLabel}
                          </span>
                          <span className="cf__sendLabel" data-when="sending">
                            Sending
                          </span>
                          <span className="cf__sendLabel" data-when="sent">
                            {sentLabel}
                          </span>
                        </span>
                        <span className="cf__sweep" aria-hidden="true" />
                      </button>

                      {failure ? (
                        <p className="cf__alert" id={alertId}>
                          {failure}
                          <a className="cf__alertLink" href={mailtoHref(values)}>
                            {SITE.email}
                          </a>
                        </p>
                      ) : null}

                      {!isContactConfigured ? (
                        <p className="cf__note" id={noteId}>
                          The direct form isn’t configured on this site yet, so this
                          opens your own mail app with the message already written.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </form>
              )}

              <div className="cf__meta cf__rise" data-rise={9}>
                <div className="cf__metaCol">
                  <span className="cf__metaK">Direct</span>
                  <a className="cf__metaV cf__metaLink" href={`mailto:${SITE.email}`}>
                    {SITE.email}
                  </a>
                </div>
                <div className="cf__metaCol">
                  <span className="cf__metaK">Based in</span>
                  <span className="cf__metaV">{SITE.location}</span>
                </div>
              </div>
            </div>

            <p className="cf__sr" role="status" aria-live="polite">
              {announcement}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
