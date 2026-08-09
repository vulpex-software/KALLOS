import ComisionesAbonos from '../components/ComisionesAbonos'
import { useAuth } from '../contexts/AuthContext'

export default function Reportes() {
  const { profile } = useAuth()
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Reportes</h1>
      <ComisionesAbonos ocultarComisiones={profile?.rol !== 'superadmin'} />
    </div>
  )
}
