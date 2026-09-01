import { Link, NavLink, useLocation } from 'react-router-dom'
import { SITE } from '../config/site'
import '../styles/nav.css'

export default function Nav() {
  const { pathname, hash } = useLocation()
  const onInfo = pathname === '/info'

  return (
    <nav className="nav" aria-label="Primary">
      <Link className="nav__mark" to="/">{SITE.name}</Link>
      <div className="nav__links">
        <NavLink className="nav__link" to="/" end>Work</NavLink>
        <Link
          className={`nav__link${onInfo && hash !== '#contact' ? ' is-active' : ''}`}
          to="/info"
        >
          Info
        </Link>
        <Link
          className={`nav__link${onInfo && hash === '#contact' ? ' is-active' : ''}`}
          to="/info#contact"
        >
          Contact
        </Link>
      </div>
    </nav>
  )
}
