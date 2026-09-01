// TEMPORARY verification entry for the scroll choreography. Delete with
// choreo-check.html once the choreography is wired into Landing.tsx.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import ScrollChoreography from './components/ScrollChoreography'
import { SphereStage, sphereDrive } from './components/Sphere'
import './styles/tokens.css'

;(window as unknown as { __drive: unknown }).__drive = sphereDrive

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main style={{ height: '100dvh', width: '100%' }}>
      <SphereStage />
      <ScrollChoreography />
    </main>
  </StrictMode>,
)
