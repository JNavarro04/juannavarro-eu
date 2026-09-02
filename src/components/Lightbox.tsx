import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { SITE } from '../config/site'
import { PHOTOS } from '../lib/photos'
import type { Photo } from '../types'
import '../styles/lightbox.css'

export type LightboxProps = {
  /** The photograph on show. `null` closes the viewer — nothing renders. */
  photo: Photo | null
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  /** 1-based position, for the counter. Omit to hide it. */
  index?: number
  total?: number
  /**
   * The neighbours, purely so their `full` files can be warmed before they are
   * asked for. Optional: when they are absent the viewer falls back to the
   * photographs either side of this one in `PHOTOS`, which is the order the
   * sphere is built from. Pass them explicitly if the caller walks a different
   * order, otherwise the wrong two files get warmed — wasteful, never wrong.
   */
  prev?: Photo | null
  next?: Photo | null
}

/**
 * The long edge of the `full` derivative. Keep in step with VARIANTS.full in
 * scripts/build-assets.mjs — it is what stops a small photograph being blown up
 * past the pixels that actually exist for it.
 */
const FULL_EDGE = 2400

/** Travel that turns a touch drag into a photograph change. */
const SWIPE_MIN = 44
/** Travel a press may wander and still count as a click on the backdrop. */
const CLICK_SLOP = 8
/** Long enough for a screen reader to notice the region emptied. */
const NOTICE_MS = 60

const FOCUSABLE = 'a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"])'

/** Anything inside one of these is the viewer itself, not the backdrop. */
const KEEP = '.lb__keep'

/** The pixels the `full` file really has, so it is never upscaled. */
function naturalSize(photo: Photo): { w: number; h: number } {
  const long = Math.max(photo.w, photo.h)
  const scale = long > FULL_EDGE ? FULL_EDGE / long : 1
  return {
    w: Math.max(1, Math.round(photo.w * scale)),
    h: Math.max(1, Math.round(photo.h * scale)),
  }
}

/**
 * EXIF writes the make into the model too, so half the library reads
 * "Canon Canon EOS 100D". Collapse a word that immediately repeats itself.
 */
function tidyCamera(value: string | undefined): string | undefined {
  if (!value) return undefined
  const words: string[] = []
  for (const word of value.trim().split(/\s+/)) {
    const last = words[words.length - 1]
    if (last === undefined || last.toLowerCase() !== word.toLowerCase()) words.push(word)
  }
  const out = words.join(' ')
  return out.length > 0 ? out : undefined
}

/** "2025-10-26" -> "2025". Anything unparseable is printed as it stands. */
function yearOf(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = /^(\d{4})/.exec(value.trim())
  if (match) return match[1]
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Camera / focal / aperture / year, from whichever of those exist. Built by
 * filtering rather than concatenating, so a missing field can never leave a
 * stray separator or the word "undefined" on the screen.
 */
function exifLine(photo: Photo): string {
  const parts = [tidyCamera(photo.exif.camera), photo.exif.focal, photo.exif.aperture, yearOf(photo.exif.date)]
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' · ')
}

/**
 * A full-viewport photograph viewer.
 *
 * Controlled: the parent owns which photograph is showing and is told when to
 * move or close. The scrim is deliberately translucent — whatever is painting
 * underneath, the sphere included, keeps painting and stays visible through it.
 */
export default function Lightbox({
  photo,
  onClose,
  onPrev,
  onNext,
  index,
  total,
  prev,
  next,
}: LightboxProps): JSX.Element | null {
  const uid = useId()
  const titleId = `${uid}-title`
  const captionId = `${uid}-caption`

  const rootRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  /** Where a press started, and whether it began on the backdrop. */
  const press = useRef<{ x: number; y: number; outside: boolean; touch: boolean } | null>(null)
  /** A swipe has already been acted on; swallow the click it drags behind it. */
  const swiped = useRef(false)
  const [shown, setShown] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [settledOn, setSettledOn] = useState<string | null>(null)

  /* Derived from props rather than stored, so a photograph swapped underneath
     us can never leave the sizing or the preloads describing the old one. */
  const open = photo !== null
  const id = photo?.id ?? null
  const mid = photo?.mid ?? null
  const full = photo?.full ?? null
  const natural = photo ? naturalSize(photo) : null
  const natW = natural?.w ?? 0
  const natH = natural?.h ?? 0

  const caption = photo === null ? '' : photo.titled ? photo.title : exifLine(photo)
  const hasCaption = caption.length > 0
  const counted = typeof index === 'number' && typeof total === 'number' && total > 0
  const position = counted ? `Photograph ${index} of ${total}` : 'Photograph'

  /* --- a different photograph --------------------------------------------- */

  /*
   * Adjusted during render rather than in an effect: React re-runs this pass
   * before it commits, so the viewer never paints one photograph's image under
   * another's caption. `mid` goes up first — the sphere has almost certainly
   * cached it already — and the average colour behind it is what shows for the
   * frame or two if it has not.
   */
  if (id !== settledOn) {
    setSettledOn(id)
    setShown(mid)
    setLoaded(false)
    // Emptied here so the live region is guaranteed to change value below,
    // which is what makes two photographs sharing a caption announce twice.
    setAnnouncement('')
  }

  /* --- promote to the full file -------------------------------------------- */

  /*
   * The swap happens only once `full` has decoded, so it lands between frames
   * and there is never a blank one in the middle of it.
   */
  useEffect(() => {
    if (full === null) return

    let cancelled = false
    const promote = () => {
      if (!cancelled) setShown(full)
    }

    const img = new Image()
    img.decoding = 'async'
    // onload is the fallback: decode() rejects rather than resolves if the
    // browser interrupts it, and a decoded-but-unpromoted image is a bug.
    img.onload = promote
    img.src = full
    void img.decode().then(promote, () => undefined)

    return () => {
      cancelled = true
      img.onload = null
    }
  }, [full])

  /* --- warm the neighbours ------------------------------------------------- */

  /*
   * Two files, never the whole library. Joined into a string so the effect is
   * keyed by what it actually fetches and does not re-run when the caller hands
   * us a fresh object describing the same photograph.
   */
  let warm: string[] = []
  if (photo !== null) {
    if (prev || next) {
      warm = [prev?.full, next?.full].filter((url): url is string => typeof url === 'string')
    } else {
      const here = PHOTOS.findIndex((p) => p.id === photo.id)
      if (here >= 0 && PHOTOS.length > 1) {
        const before = PHOTOS[(here - 1 + PHOTOS.length) % PHOTOS.length]
        const after = PHOTOS[(here + 1) % PHOTOS.length]
        warm = [before, after]
          .filter((p): p is Photo => p !== undefined && p.id !== photo.id)
          .map((p) => p.full)
      }
    }
  }
  const warmKey = warm.join('\n')

  useEffect(() => {
    if (warmKey.length === 0) return
    // Held in a local so the requests are not collected mid-flight; there is no
    // way to abort an Image fetch, so the cleanup only drops the handles.
    const held = warmKey.split('\n').map((url) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      return img
    })
    return () => {
      for (const img of held) {
        img.onload = null
        img.onerror = null
      }
    }
  }, [warmKey])

  /* --- body scroll lock ---------------------------------------------------- */

  /*
   * A layout effect, and declared above the sizing one on purpose: taking the
   * scrollbar away changes how much room the photograph has, and layout effects
   * run in declaration order, so this happens before anything measures.
   */
  useLayoutEffect(() => {
    if (!open) return
    const body = document.body
    const overflow = body.style.overflow
    const padding = body.style.paddingRight
    const bar = window.innerWidth - document.documentElement.clientWidth

    body.style.overflow = 'hidden'
    // Hold the page still: without this the whole layout jumps left by the
    // width of the scrollbar the line above just removed.
    if (bar > 0) body.style.paddingRight = `${bar}px`

    return () => {
      body.style.overflow = overflow
      body.style.paddingRight = padding
    }
  }, [open])

  /* --- fit the photograph to whatever room is left ------------------------- */

  /*
   * Measured rather than expressed in CSS: the stage is what is left after two
   * bars of type that wrap differently at every width, and only the box itself
   * knows how tall that is. Written straight to the node — a photograph
   * resizing with the window must not cost a React render.
   */
  useLayoutEffect(() => {
    const stage = stageRef.current
    const frame = frameRef.current
    if (!stage || !frame || natW <= 0 || natH <= 0) return

    const fit = () => {
      // The content box: the stage carries the mount padding above and below
      // the photograph, which is margin, not room.
      const style = getComputedStyle(stage)
      const roomW =
        stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const roomH =
        stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      if (!(roomW > 0) || !(roomH > 0)) return
      const scale = Math.min(roomW / natW, roomH / natH, 1)
      frame.style.width = `${Math.max(1, Math.round(natW * scale))}px`
      frame.style.height = `${Math.max(1, Math.round(natH * scale))}px`
    }

    fit()

    // Two ways in, because they cover different things: the observer catches a
    // bar wrapping to a second line, the listener catches a window resize in
    // the rare engine that defers observations.
    const observer = new ResizeObserver(fit)
    observer.observe(stage)
    window.addEventListener('resize', fit)
    window.addEventListener('orientationchange', fit)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
      window.removeEventListener('orientationchange', fit)
    }
  }, [natW, natH])

  /* --- the rest of the page goes inert ------------------------------------- */

  /*
   * aria-modal hides the page from a screen reader; inert hides it from every
   * other input method too. Children that are already inert are left alone and
   * never restored, so a second overlay opening over this one composes rather
   * than fights. Declared above the focus effect on purpose: cleanups run in
   * declaration order, so whatever opened the viewer is interactive again
   * before focus is handed back to it.
   */
  useEffect(() => {
    if (!open) return
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
  }, [open])

  /* --- focus in, focus back ------------------------------------------------ */

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // The dialog itself, not the first button: a screen reader then reads the
    // photograph's label before it reads a control.
    dialogRef.current?.focus({ preventScroll: true })

    return () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open])

  /* --- keys: escape, arrows, and the trap ---------------------------------- */

  /*
   * One handler for all three, so the arrows can never race the trap: they move
   * the photograph and are done, and Tab is the only key that touches focus.
   */
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      // Another overlay has opened over this one and made us inert. Its keys.
      if (rootRef.current?.inert === true) return
      if (event.altKey || event.ctrlKey || event.metaKey) return

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onPrev()
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        onNext()
        return
      }

      if (event.key !== 'Tab') return

      const root = dialogRef.current
      if (!root) return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1 && el.offsetParent !== null,
      )

      if (items.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return

      const active = document.activeElement
      const inside = active instanceof Node && root.contains(active)

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
  }, [open, onClose, onPrev, onNext])

  /* --- say what changed ---------------------------------------------------- */

  /*
   * The region was emptied during render; filling it a beat later is what a
   * screen reader hears as a change rather than as the same sentence again.
   */
  useEffect(() => {
    if (id === null) return
    const text = hasCaption ? `${position}. ${caption}` : position
    const timer = window.setTimeout(() => setAnnouncement(text), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [id, position, caption, hasCaption])

  /* --- pointer: backdrop dismiss and swipe --------------------------------- */

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return
    const target = event.target instanceof Element ? event.target : null
    press.current = {
      x: event.clientX,
      y: event.clientY,
      outside: target !== null && target.closest(KEEP) === null,
      touch: event.pointerType !== 'mouse',
    }
  }, [])

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = press.current
      press.current = null
      if (!start || !event.isPrimary) return

      const dx = event.clientX - start.x
      const dy = event.clientY - start.y

      // A horizontal drag on touch is a page turn, wherever it started — the
      // photograph is the natural thing to drag, and it fills the stage.
      if (start.touch && Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.3) {
        // A swipe that began on one of the arrows would otherwise turn the page
        // twice: once here, once when its click lands.
        swiped.current = true
        if (dx < 0) onNext()
        else onPrev()
        return
      }

      // Otherwise it is a click, and only a click that starts and ends on the
      // backdrop without wandering dismisses.
      if (!start.outside) return
      if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) return
      const target = event.target instanceof Element ? event.target : null
      if (target !== null && target.closest(KEEP) !== null) return
      onClose()
    },
    [onClose, onNext, onPrev],
  )

  const onPointerCancel = useCallback(() => {
    press.current = null
  }, [])

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!swiped.current) return
    swiped.current = false
    event.stopPropagation()
    event.preventDefault()
  }, [])

  if (photo === null) return null

  const digits = counted && typeof total === 'number' ? String(total).length : 0
  const alt = photo.titled
    ? `${photo.title}. Photograph by ${SITE.name}.`
    : `Untitled photograph by ${SITE.name}.`

  return createPortal(
    <div className="lb" ref={rootRef}>
      <div className="lb__scrim" aria-hidden="true" />

      <div
        className="lb__dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasCaption ? captionId : titleId}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
      >
        {/* The label, when there is no caption to serve as one. */}
        {hasCaption ? null : (
          <h2 className="lb__sr" id={titleId}>
            {position}
          </h2>
        )}

        <header className="lb__bar lb__bar--top">
          {counted && typeof index === 'number' && typeof total === 'number' ? (
            <p className="lb__count lb__keep">
              <span className="lb__sr">{position}</span>
              <span aria-hidden="true">
                {String(index).padStart(digits, '0')} / {total}
              </span>
            </p>
          ) : (
            <span />
          )}

          <button type="button" className="lb__close lb__keep" onClick={onClose}>
            Close
            <svg className="lb__closeGlyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <line x1="1" y1="1" x2="11" y2="11" />
              <line x1="11" y1="1" x2="1" y2="11" />
            </svg>
            {/* Makes the accessible name read "Close photograph". */}
            <span className="lb__sr">{' photograph'}</span>
          </button>
        </header>

        <div className="lb__stage" ref={stageRef}>
          <div
            className="lb__frame lb__keep"
            ref={frameRef}
            style={{ backgroundColor: photo.color }}
          >
            {shown === null ? null : (
              <img
                className="lb__img"
                src={shown}
                alt={alt}
                width={natW}
                height={natH}
                draggable={false}
                decoding="async"
                data-loaded={loaded ? 'true' : 'false'}
                // The image is revealed by opacity, so a load event that never
                // arrives would leave it invisible for good. A file already in
                // cache can be complete before the handler is attached, and a
                // broken one never loads at all — both are caught here rather
                // than left to the one event.
                ref={(el) => {
                  if (el && el.complete && el.naturalWidth > 0) setLoaded(true)
                }}
                onLoad={() => setLoaded(true)}
                onError={() => setLoaded(true)}
              />
            )}
          </div>
        </div>

        <footer className="lb__bar lb__bar--bottom">
          {hasCaption ? (
            <p
              className={`lb__caption lb__keep${photo.titled ? '' : ' lb__caption--meta'}`}
              id={captionId}
            >
              {caption}
            </p>
          ) : (
            <span />
          )}

          <div className="lb__steps lb__keep">
            <button type="button" className="lb__step" onClick={onPrev}>
              <svg className="lb__stepGlyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <polyline points="7.5,1 2.5,6 7.5,11" />
              </svg>
              <span className="lb__sr">Previous photograph</span>
            </button>
            <button type="button" className="lb__step" onClick={onNext}>
              <svg className="lb__stepGlyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <polyline points="4.5,1 9.5,6 4.5,11" />
              </svg>
              <span className="lb__sr">Next photograph</span>
            </button>
          </div>
        </footer>

        <p className="lb__sr" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </div>,
    document.body,
  )
}
