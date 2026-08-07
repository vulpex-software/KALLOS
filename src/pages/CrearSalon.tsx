import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { normalizarCorreoOUsuario } from '../lib/authDominio'
import { generarSlug } from '../lib/slug'

// Alta self-serve: cualquiera puede crear su salón y quedar activo de
// inmediato (sin aprobación del operador) -- ver crear_salon_self_serve()
// en supabase/schema.sql. El primer usuario de un salón nuevo queda
// superadmin automáticamente (handle_new_user()), así que no hace falta
// ningún paso de promoción acá.
export default function CrearSalon() {
  const navigate = useNavigate()
  const [nombreSalon, setNombreSalon] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)
  const [duenaNombre, setDuenaNombre] = useState('')
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [telefono, setTelefono] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState(false)

  function cambiarNombreSalon(v: string) {
    setNombreSalon(v)
    if (!slugTocado) setSlug(generarSlug(v))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    setLoading(true)

    const { data: salonId, error: errRpc } = await supabase.rpc('crear_salon_self_serve', {
      p_nombre: nombreSalon.trim(),
      p_slug: generarSlug(slug),
      p_duena_nombre: duenaNombre.trim(),
      p_contacto_telefono: telefono.trim() || null
    })
    if (errRpc || !salonId) {
      setLoading(false)
      setError(
        errRpc?.message.toLowerCase().includes('duplicate') || errRpc?.message.toLowerCase().includes('unique')
          ? 'Ese nombre de URL ya está en uso. Prueba con otro.'
          : errRpc?.message ?? 'No se pudo crear el salón.'
      )
      return
    }

    const email = normalizarCorreoOUsuario(usuario)
    const { data: signup, error: errSignup } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { nombre: duenaNombre.trim(), telefono: telefono.trim(), salon_id: salonId } }
    })
    setLoading(false)
    if (errSignup) {
      setError(
        errSignup.message.toLowerCase().includes('registered') || errSignup.message.toLowerCase().includes('already')
          ? 'Ese usuario/correo ya existe. Inicia sesión en vez de crear una cuenta nueva.'
          : 'El salón quedó creado pero no se pudo crear tu acceso: ' + errSignup.message
      )
      return
    }
    setListo(true)
    if (signup.session) {
      setTimeout(() => navigate('/', { replace: true }), 1500)
    }
  }

  if (listo) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-neutral-300 [background-image:radial-gradient(circle_at_50%_35%,#e5e5e5_0%,#a8a8a8_100%)]">
        <div className="w-full max-w-sm bg-ink rounded-2xl shadow-2xl border border-brand-700/40 p-8 text-center space-y-3">
          <p className="text-brand-300 font-semibold">¡Tu salón ya está listo!</p>
          <p className="text-sm text-gray-400">
            {nombreSalon} ya está activo en KALLOS. Puedes iniciar sesión con el usuario y la contraseña que elegiste.
          </p>
          <Link to="/login" className="inline-block bg-brand-500 hover:bg-brand-600 text-ink rounded-lg px-4 py-2 text-sm font-semibold">
            Iniciar sesión
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-neutral-300 [background-image:radial-gradient(circle_at_50%_35%,#e5e5e5_0%,#a8a8a8_100%)]">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-ink rounded-2xl shadow-2xl border border-brand-700/40 p-8 space-y-4">
        <div className="text-center">
          <img src="/logo.png" alt="KALLOS" className="w-20 h-20 mx-auto object-contain" />
          <p className="font-serif font-semibold text-brand-300 tracking-[0.3em] text-lg mt-1">KALLOS</p>
          <p className="text-sm text-gray-400 mt-2">Crea el salón y empieza a usarlo ya mismo</p>
        </div>

        {error && <div className="text-sm bg-red-950/60 text-red-300 border border-red-800 rounded-lg p-2">{error}</div>}

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-300">Nombre del salón</label>
          <input required value={nombreSalon} onChange={(e) => cambiarNombreSalon(e.target.value)} placeholder="Laura's Spa"
            className="w-full rounded-lg bg-surface border border-gray-700 text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-300">URL de tu salón</label>
          <input required value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTocado(true) }}
            className="w-full rounded-lg bg-surface border border-gray-700 text-gray-100 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
          <p className="text-xs text-gray-500 mt-1">Tus clientas se registran en /registro-cliente/{generarSlug(slug) || '…'}</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-300">Tu nombre (dueña/administradora)</label>
          <input required value={duenaNombre} onChange={(e) => setDuenaNombre(e.target.value)}
            className="w-full rounded-lg bg-surface border border-gray-700 text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">Usuario o correo</label>
            <input required autoCapitalize="none" value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="laura"
              className="w-full rounded-lg bg-surface border border-gray-700 text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">Contraseña</label>
            <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-surface border border-gray-700 text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-300">Teléfono (opcional)</label>
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="3001234567"
            className="w-full rounded-lg bg-surface border border-gray-700 text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
        </div>

        <button type="submit" disabled={loading} className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-ink font-semibold rounded-lg py-2 transition">
          {loading ? 'Creando tu salón…' : 'Crear mi salón gratis'}
        </button>

        <p className="text-center text-sm text-gray-400">
          ¿Ya tienes cuenta? <Link to="/login" className="text-brand-400 font-medium">Inicia sesión</Link>
        </p>
        <p className="text-center text-[11px] text-gray-600">Developed by Vulpex Software SAS</p>
      </form>
    </div>
  )
}
