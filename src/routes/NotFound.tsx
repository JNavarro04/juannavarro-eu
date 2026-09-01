import { Link } from 'react-router-dom'
import '../styles/pages.css'

export default function NotFound() {
  return (
    <main className="page">
      <section className="page__stage" style={{ justifyContent: 'center', minHeight: '100svh' }}>
        <p className="label">404</p>
        <h1 className="statement" style={{ maxWidth: '16ch' }}>
          <span className="statement__w" style={{ animationDelay: '120ms' }}>This&nbsp;</span>
          <span className="statement__w" style={{ animationDelay: '190ms' }}>frame&nbsp;</span>
          <span className="statement__w" style={{ animationDelay: '260ms' }}>doesn&rsquo;t&nbsp;</span>
          <span className="statement__w" style={{ animationDelay: '330ms' }}>exist.</span>
        </h1>
        <Link className="back" to="/" style={{ marginTop: '2.5rem' }}>
          <span aria-hidden="true">←</span> Back to the work
        </Link>
      </section>
    </main>
  )
}
