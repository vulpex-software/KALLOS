import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const destinoPorRol: Record<string, string> = {
  personal: '/jornada',
  admin: '/cobros',
  superadmin: '/dashboard',
  cliente: '/portal'
}

export default function Home() {
  const { profile, esOperador } = useAuth()
  if (!profile) return null
  // El operador de plataforma aterriza en su consola, no en el dashboard
  // del salón (el suyo es el salón especial "KALLOS Plataforma", vacío).
  if (esOperador) return <Navigate to="/plataforma" replace />
  return <Navigate to={destinoPorRol[profile.rol] ?? '/login'} replace />
}
