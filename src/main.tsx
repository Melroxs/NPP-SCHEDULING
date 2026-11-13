import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isSupabaseConfigured } from './lib/supabase'

const root = createRoot(document.getElementById('root')!)

if (!isSupabaseConfigured) {
  // Misconfigured deployments get an actionable message instead of a blank page.
  root.render(
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold">Configuration required</h1>
        <p className="text-sm text-muted-foreground">
          This deployment is missing <code>VITE_SUPABASE_URL</code> and/or{' '}
          <code>VITE_SUPABASE_ANON_KEY</code>. Set them in the hosting environment and
          redeploy.
        </p>
      </div>
    </div>,
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
