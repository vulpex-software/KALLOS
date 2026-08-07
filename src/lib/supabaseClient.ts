import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copia .env.example a .env y completa los valores de tu proyecto Supabase.'
  )
}

export const supabase = createClient(url, anonKey)

// Cliente "de un solo uso" que NO guarda sesión. Sirve para que el superadmin
// pueda crear una cuenta nueva (auth.signUp) sin que eso cierre su propia sesión.
export function crearClienteEfimero() {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: 'sb-efimero-' + Math.random().toString(36).slice(2)
    }
  })
}
