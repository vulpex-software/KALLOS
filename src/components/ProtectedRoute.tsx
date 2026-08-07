import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Rol } from '../types'

export default function ProtectedRoute({
  roles,
  children
}: {
  roles?: Rol[]
  children: React.ReactNode
}) {
  const { session, profile, loading, signOut } = useAuth()

  if (loading) return <div className="p-6 text-sm text-gray-400">Cargando…</div>
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <div className="p-6 text-sm text-gray-400">Tu cuenta aún no tiene un perfil asignado. Pide a la dueña que te lo cree.</div>

  // Cuenta desactivada: se le quitó el acceso.
  if (!profile.activo) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-3">
          <p className="text-sm text-gray-700">Tu cuenta está desactivada. Contacta a la administración.</p>
          <button onClick={signOut} className="text-sm text-brand-600 font-medium">Salir</button>
        </div>
      </div>
    )
  }

  // El superadmin puede entrar a cualquier sección.
  if (roles && profile.rol !== 'superadmin' && !roles.includes(profile.rol)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
