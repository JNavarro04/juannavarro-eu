import { lazy, Suspense, useCallback } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import Info from './routes/Info'
import NotFound from './routes/NotFound'
import Nav from './components/Nav'
import ContactForm from './components/ContactForm'

/**
 * The landing route is split out because it pulls in three.js — ~240kB gzipped
 * of the bundle. /info and /contact use no WebGL at all and should not pay for
 * it. On `/` the extra round trip is immaterial next to the 1.8MB photo atlas
 * that route is already fetching.
 */
const Landing = lazy(() => import('./routes/Landing'))

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()

  // Info and Contact are one page, so /contact renders Info with the form over
  // it. That keeps the form a real, linkable, shareable URL rather than a state
  // flag the visitor cannot bookmark or reach with the back button.
  const contactOpen = location.pathname === '/contact'

  // Closing returns to /info rather than history.back(): a visitor who landed
  // on /contact directly has nothing to go back to.
  const closeContact = useCallback(() => {
    navigate('/info', { replace: true })
  }, [navigate])

  return (
    <>
      <Nav />
      <Suspense fallback={<div className="route-fallback" aria-hidden="true" />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/info" element={<Info />} />
          <Route path="/contact" element={<Info />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <ContactForm open={contactOpen} onClose={closeContact} />
    </>
  )
}
