import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Le port 3000 correspond à l'adresse de retour par défaut des liens de connexion Supabase.
  server: { port: 3000, strictPort: true },
})
