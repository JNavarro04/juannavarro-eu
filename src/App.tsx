import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Info from './routes/Info'
import NotFound from './routes/NotFound'
import Nav from './components/Nav'

/**
 * The landing route is split out because it pulls in three.js — ~320kB gzipped
 * of the bundle. /info and /contact use no WebGL at all and should not pay for
 * it. On `/` the extra round trip is immaterial next to the 1.8MB photo atlas
 * that route is already fetching.
 */
const Landing = lazy(() => import('./routes/Landing'))

export default function App() {
  return (
    <>
      <Nav />
      <Suspense fallback={<div className="route-fallback" aria-hidden="true" />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/info" element={<Info />} />
          {/* Info and Contact are one page; /contact stays a real, linkable entry point. */}
          <Route path="/contact" element={<Navigate to="/info#contact" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  )
}
