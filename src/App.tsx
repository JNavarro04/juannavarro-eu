import { Routes, Route } from 'react-router-dom'
import Landing from './routes/Landing'
import Info from './routes/Info'
import Contact from './routes/Contact'
import NotFound from './routes/NotFound'
import Nav from './components/Nav'

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/info" element={<Info />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
