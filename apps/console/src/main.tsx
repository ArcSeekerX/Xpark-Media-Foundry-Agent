import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, readStoredTheme } from './hooks/useTheme'

// Apply the stored theme before the first paint — no dark/light flash.
applyTheme(readStoredTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
