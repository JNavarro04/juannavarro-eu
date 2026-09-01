import { NavLink, Link } from 'react-router-dom'
import { SITE } from '../config/site'
import '../styles/nav.css'

const INSTAGRAM = SITE.socials[0]

/** "Juan Navarro" → "JN". Replaces the wordmark below ~360px so nothing wraps. */
const INITIALS = SITE.name
  .split(' ')
  .map((word) => word.charAt(0))
  .join('')

/*
 * Both marks are drawn in the same 24-unit box and every stroke carries
 * vector-effect="non-scaling-stroke", so the line weight is exactly 1.5 CSS px
 * whatever size the box is rendered at — the two icons can never drift apart.
 *
 * Optical sizing: a square reads bigger and heavier than a wide rectangle at the
 * same box size, and the envelope's flap adds ink the square does not have. So
 * the Instagram frame is held to 17.3 × 17.3 while the envelope is let out only
 * as far as 18.8 × 14.8 — measured side by side at 5× and at 1:1, that is where
 * neither one starts to dominate.
 */

function InstagramMark() {
  return (
    <svg
      className="nav__glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="3.35"
        y="3.35"
        width="17.3"
        height="17.3"
        rx="4.9"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="12" cy="12" r="3.8" vectorEffect="non-scaling-stroke" />
      {/* Zero-length round-capped dash: renders as a true 1.9px dot at any scale.
          Sits 0.9px clear of the frame and the lens on all three sides. */}
      <path d="M17.15 6.85h.01" strokeWidth={1.9} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function EnvelopeMark() {
  return (
    <svg
      className="nav__glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2.6"
        y="4.6"
        width="18.8"
        height="14.8"
        rx="2.35"
        vectorEffect="non-scaling-stroke"
      />
      {/* Flap creases start just inside the top corner arcs, so the round caps
          merge into the outline instead of poking out past it. */}
      <path d="M3.85 5.5 12 11.2l8.15-5.7" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function Nav() {
  return (
    <nav className="nav" aria-label="Primary">
      <Link className="nav__mark" to="/" aria-label={SITE.name}>
        <span className="nav__mark-full" aria-hidden="true">{SITE.name}</span>
        <span className="nav__mark-short" aria-hidden="true">{INITIALS}</span>
      </Link>

      <div className="nav__links">
        <NavLink className="nav__link" to="/" end>Work</NavLink>
        <NavLink className="nav__link" to="/info">Info</NavLink>

        <span className="nav__icons">
          <a
            className="nav__icon"
            href={INSTAGRAM.href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={INSTAGRAM.label}
          >
            <InstagramMark />
          </a>
          <NavLink className="nav__icon" to="/contact" aria-label="Contact">
            <EnvelopeMark />
          </NavLink>
        </span>
      </div>
    </nav>
  )
}
