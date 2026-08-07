import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { DOMINIO_INTERNO } from '../lib/authDominio'
import { logoParaSalon } from '../lib/branding'
import type { Salon } from '../types'

export default function RegistroCliente() {
  const { salonSlug } = useParams<{ salonSlug?: string }>()
  const [salon, setSalon] = useState<Salon | null>(null)
  const [buscandoSalon, setBuscandoSalon] = useState(!!salonSlug)
  const [nombre, setNombre] = useState('')
  const [cedula, setCedula] = useState('')
  const [telefono, setTelefono] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState<'sesion' | 'confirmar' | null>(null)

  useEffect(() => {
    if (!salonSlug) {
      setBuscandoSalon(false)
      return
    }
    let cancelado = false
    setBuscandoSalon(true)
    supabase
      .from('salones')
      .select('*')
      .eq('slug', salonSlug)
      .eq('activo', true)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelado) {
          setSalon((data as Salon) ?? null)
          setBuscandoSalon(false)
        }
      })
    return () => {
      cancelado = true
    }
  }, [salonSlug])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!salon) {
      setError('Este link no corresponde a un salón válido. Pídele a tu salón el link correcto.')
      return
    }

    const ced = cedula.trim()
    if (ced.length < 6) {
      setError('La cédula debe tener al menos 6 dígitos.')
      return
    }
    setLoading(true)

    // La cédula es el usuario Y la contraseña (fácil de recordar para las clientas).
    const { data, error } = await supabase.auth.signUp({
      email: `${ced}@${DOMINIO_INTERNO}`,
      password: ced,
      options: { data: { nombre, telefono, cedula: ced, salon_id: salon.id } }
    })
    setLoading(false)

    if (error) {
      setError(
        error.message.toLowerCase().includes('registered') || error.message.toLowerCase().includes('already')
          ? 'Esa cédula ya está registrada. Inicia sesión con tu cédula.'
          : 'No se pudo crear la cuenta. Revisa los datos e intenta de nuevo.'
      )
      return
    }
    setListo(data.session ? 'sesion' : 'confirmar')
  }

  if (buscandoSalon) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Cargando…</div>
  }

  if (!salon) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 text-center space-y-3">
          <p className="text-brand-700 font-semibold">Link no válido</p>
          <p className="text-sm text-gray-500">
            Este link de registro no corresponde a ningún salón activo. Pídele a tu salón que te comparta su link de registro correcto.
          </p>
        </div>
      </div>
    )
  }

  if (listo === 'sesion') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 text-center space-y-3">
          <p className="text-brand-700 font-semibold">¡Cuenta creada!</p>
          <p className="text-sm text-gray-500">Ya puedes solicitar tu cita. Recuerda: tu usuario y contraseña son tu <b>cédula</b>.</p>
          <Link to="/portal" className="inline-block bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium">Ir a mi portal</Link>
        </div>
      </div>
    )
  }

  if (listo === 'confirmar') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 text-center space-y-3">
          <p className="text-brand-700 font-semibold">¡Cuenta creada!</p>
          <p className="text-sm text-gray-500">Ya puedes iniciar sesión con tu <b>cédula</b> como usuario y como contraseña.</p>
          <Link to="/login" className="inline-block bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium">Iniciar sesión</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4">
        <div className="text-center">
          <img src={logoParaSalon(salon)} alt={salon.nombre} className="w-24 h-24 mx-auto object-contain" />
          <h1 className="text-lg font-semibold text-brand-700 mt-2">Crea tu cuenta en {salon.nombre}</h1>
          <p className="text-sm text-gray-500">Para pedir tus citas fácilmente</p>
        </div>

        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}

        <div>
          <label className="block text-sm font-medium mb-1">Nombre completo</label>
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Cédula (NUIP / CC)</label>
          <input
            required
            inputMode="numeric"
            value={cedula}
            onChange={(e) => setCedula(e.target.value)}
            placeholder="Tu número de documento"
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
          <p className="text-xs text-gray-400 mt-1">Con tu cédula ingresarás: es tu usuario y tu contraseña.</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Teléfono (WhatsApp)</label>
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="3001234567" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>

        <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
          {loading ? 'Creando…' : 'Crear cuenta'}
        </button>

        <p className="text-center text-sm text-gray-500">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-brand-600 font-medium">Inicia sesión con tu cédula</Link>
        </p>
        <p className="text-center text-[11px] text-gray-300">Developed by Vulpex Software SAS</p>
      </form>
    </div>
  )
}
