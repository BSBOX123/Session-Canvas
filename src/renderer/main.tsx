import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

if (import.meta.env.DEV) {
  const { installDevBridge } = await import('./devBridge')
  installDevBridge()
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
