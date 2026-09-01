import { useEffect, useRef } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { SITE } from '../config/site'
import PhotoHorizon from '../components/PhotoHorizon'
import '../styles/pages.css'

/** Splits a sentence into words that can be revealed one at a time. */
const words = (s: string) => s.split(' ')

export default function Info() {
  const { hash } = useLocation()
  const contactRef = useRef<HTMLElement>(null)

  // /contact redirects here with #contact — honour it once the page has laid out.
  useEffect(() => {
    if (hash !== '#contact') return
    const t = window.setTimeout(() => {
      contactRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
    }, 60)
    return () => window.clearTimeout(t)
  }, [hash])

  return (
    <main className="page">
      <section className="page__stage">
        <p className="label">01 — Info</p>

        <h1 className="statement">
          {words(SITE.bio[0]).map((w, i) => (
            <span key={i} className="statement__w" style={{ animationDelay: `${140 + i * 42}ms` }}>
              {w}
            </span>
          ))}
        </h1>

        <p className="statement__sub">
          {SITE.bio[1]}
        </p>

        <PhotoHorizon />
      </section>

      <section className="page__contact" id="contact" ref={contactRef}>
        <p className="label">02 — Contact</p>

        <a className="mailto" href={`mailto:${SITE.email}`}>
          <span className="mailto__text">{SITE.email}</span>
        </a>

        <div className="meta">
          <div className="meta__col">
            <span className="meta__k">Elsewhere</span>
            {SITE.socials.map((s) => (
              <a key={s.href} className="meta__v meta__link" href={s.href} target="_blank" rel="noreferrer noopener">
                {s.label} <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
          <div className="meta__col">
            <span className="meta__k">Based in</span>
            <span className="meta__v">{SITE.location}</span>
          </div>
          <div className="meta__col">
            <span className="meta__k">Shot on</span>
            {SITE.kit.map((k) => (
              <span key={k} className="meta__v">{k}</span>
            ))}
          </div>
        </div>

        <Link className="back" to="/">
          <span aria-hidden="true">←</span> Back to the work
        </Link>
      </section>
    </main>
  )
}
