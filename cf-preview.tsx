/* TEMPORARY scratch harness for verifying ContactForm. Delete before reporting. */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ContactForm from './src/components/ContactForm'
import './src/styles/tokens.css'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <main style={{ padding: '4rem clamp(1.5rem, 6vw, 7rem)' }}>
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--step--1)',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-soft)',
        }}
      >
        Scratch harness
      </p>
      <h1 style={{ fontWeight: 300, fontSize: 'var(--step-2)', letterSpacing: '-0.025em' }}>
        Some page behind the overlay.
      </h1>
      <p style={{ maxWidth: '40ch', color: 'var(--ink-soft)', lineHeight: 1.6 }}>
        The button below is the trigger — focus must come back to it on close.
      </p>
      <button id="trigger" type="button" onClick={() => setOpen(true)}>
        Open contact
      </button>
      <div style={{ height: '200vh' }} />
      <ContactForm open={open} onClose={() => setOpen(false)} />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
