import { Routes, Route, Navigate } from 'react-router-dom'
import Landing from './routes/Landing'
import Info from './routes/Info'
import NotFound from './routes/NotFound'
import Nav from './components/Nav'

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/info" element={<Info />} />
        {/* Info and Contact are one page; /contact stays a real, linkable entry point. */}
        <Route path="/contact" element={<Navigate to="/info#contact" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
