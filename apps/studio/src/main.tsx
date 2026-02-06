import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setWasmPath } from '@manifold-studio/react-manifold'
import './index.css'
import App from './App.tsx'

// Set path to WASM file (copied to public by vite-plugin-static-copy)
setWasmPath('/manifold.wasm')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
