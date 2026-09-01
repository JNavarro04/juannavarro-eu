import { Link } from 'react-router-dom'
export default function Nav() {
  return (
    <nav style={{ position: 'fixed', top: 0, right: 0, padding: '1.5rem 2rem', zIndex: 100, display: 'flex', gap: '1.5rem' }}>
      <Link to="/">Work</Link><Link to="/info">Info</Link><Link to="/contact">Contact</Link>
    </nav>
  )
}
