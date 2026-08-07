import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { Profile, Salon } from '../types'
import { aplicarTemaSalon } from '../lib/theme'

interface AuthState {
  session: Session | null
  profile: Profile | null
  salon: Salon | null
  // true si el usuario es operador de la plataforma KALLOS (Vulpex):
  // administra todos los salones desde /plataforma. No confundir con el
  // superadmin de un salón cliente.
  esOperador: boolean
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [salon, setSalon] = useState<Salon | null>(null)
  const [esOperador, setEsOperador] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      if (!session?.user) {
        setProfile(null)
        setSalon(null)
        setEsOperador(false)
        aplicarTemaSalon(null)
        setLoading(false)
        return
      }
      setLoading(true)
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()
      if (cancelled) return
      setProfile(data ?? null)

      // Solo el propio operador puede leer su fila (RLS), así que esta
      // consulta devuelve vacío para cualquier usuario normal.
      const { data: op } = await supabase
        .from('plataforma_operadores')
        .select('user_id')
        .eq('user_id', session.user.id)
        .maybeSingle()
      if (cancelled) return
      setEsOperador(!!op)

      let salonData: Salon | null = null
      if (data?.salon_id) {
        const { data: s } = await supabase
          .from('salones')
          .select('*')
          .eq('id', data.salon_id)
          .single()
        salonData = s ?? null
      }
      if (!cancelled) {
        setSalon(salonData)
        aplicarTemaSalon(salonData)
        setLoading(false)
      }
    }

    loadProfile()
    return () => {
      cancelled = true
    }
  }, [session])

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, profile, salon, esOperador, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
