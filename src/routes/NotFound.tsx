import { Link } from 'react-router-dom'
export default function NotFound() {
  return (
    <main style={{ height: '100vh', display: 'grid', placeItems: 'center', gap: '1rem' }}>
      <p>Nothing here.</p>
      <Link to="/">Back to the sphere</Link>
    </main>
  )
}
