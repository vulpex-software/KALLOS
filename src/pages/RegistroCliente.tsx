import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { crearClienta } from '../lib/crearClienta'
import { logoParaSalon } from '../lib/branding'
import type { Salon } from '../types'

// Lo mínimo para listar salones en el buscador (sin slug en la URL).
interface SalonBasico {
  id: string
  nombre: string
  slug: string
}

export default function RegistroCliente() {
  const { salonSlug } = useParams<{ salonSlug?: string }>()
  const navigate = useNavigate()

  // Esta página es pública -- cualquiera puede llegar aquí con OTRA sesión
  // ya guardada en el navegador (una operadora probando, un computador
  // compartido). Si no cerramos esa sesión antes de ir a /login, esa
  // pantalla ve que ya hay sesión y rebota directo al inicio de ESA cuenta
  // en vez de mostrar el formulario -- confuso para quien solo quería
  // entrar con la suya. Ver también CrearSalon.tsx (mismo patrón).
  async function irALogin() {
    await supabase.auth.signOut()
    navigate('/login')
  }
  const [salon, setSalon] = useState<Salon | null>(null)
  const [buscandoSalon, setBuscandoSalon] = useState(!!salonSlug)
  // Cuando no llega un slug en la URL (ej. desde el link genérico de
  // Login), no sabemos a qué salón pertenece la clienta -- se le deja
  // buscar el suyo por nombre en vez de dejarla en un callejón sin salida.
  const [salones, setSalones] = useState<SalonBasico[]>([])
  const [cargandoSalones, setCargandoSalones] = useState(false)
  const [busquedaSalon, setBusquedaSalon] = useState('')
  const [nombre, setNombre] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [telefono, setTelefono] = useState('')
  // Usuario y contraseña se autocompletan con el teléfono (fácil de
  // recordar), pero se pueden cambiar -- una vez que la clienta toca el
  // campo, dejan de seguir al teléfono.
  const [usuario, setUsuario] = useState('')
  const [usuarioTocado, setUsuarioTocado] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordTocado, setPasswordTocado] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState<'sesion' | 'confirmar' | null>(null)

  function cambiarTelefono(v: string) {
    setTelefono(v)
    if (!usuarioTocado) setUsuario(v)
    if (!passwordTocado) setPassword(v)
  }

  useEffect(() => {
    if (!salonSlug) {
      setBuscandoSalon(false)
      let cancelado = false
      setCargandoSalones(true)
      supabase
        .from('salones')
        .select('id, nombre, slug')
        .eq('activo', true)
        .order('nombre')
        .then(({ data }) => {
          if (!cancelado) {
            setSalones((data as SalonBasico[]) ?? [])
            setCargandoSalones(false)
          }
        })
      return () => {
        cancelado = true
      }
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

    if (!telefono.trim()) {
      setError('Escribe tu número de teléfono.')
      return
    }
    if (password.trim().length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    setLoading(true)
    const { id, error: errCrear } = await crearClienta({
      salonId: salon.id,
      nombre,
      apellidos,
      telefono,
      usuario,
      password
    })
    setLoading(false)

    if (errCrear || !id) {
      setError(
        errCrear === 'Ese usuario ya está registrado.'
          ? 'Ese usuario ya está registrado. Inicia sesión con tu usuario y contraseña.'
          : errCrear || 'No se pudo crear la cuenta. Revisa los datos e intenta de nuevo.'
      )
      return
    }
    // signUp() con el cliente normal ya deja la sesión activa en este navegador
    // salvo que Supabase pida confirmar el correo (no aplica acá, es sintético).
    const { data: sesionActual } = await supabase.auth.getSession()
    setListo(sesionActual.session ? 'sesion' : 'confirmar')
  }

  if (buscandoSalon) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Cargando…</div>
  }

  if (!salon && salonSlug) {
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

  // Sin slug en la URL: se le deja buscar su salón por nombre y registrarse
  // ella sola, igual que antes -- solo que ahora primero elige a cuál.
  if (!salon) {
    const salonesFiltrados = salones.filter((s) =>
      s.nombre.toLowerCase().includes(busquedaSalon.trim().toLowerCase())
    )
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4">
          <div className="text-center">
            <img src="/logo.png" alt="KALLOS" className="w-16 h-16 mx-auto object-contain" />
            <h1 className="text-lg font-semibold text-brand-700 mt-2">¿En qué salón quieres registrarte?</h1>
            <p className="text-sm text-gray-500">Busca el nombre de tu salón para crear tu cuenta.</p>
          </div>

          <input
            type="text"
            autoFocus
            value={busquedaSalon}
            onChange={(e) => setBusquedaSalon(e.target.value)}
            placeholder="Nombre del salón…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />

          <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
            {salonesFiltrados.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/registro-cliente/${s.slug}`)}
                  className="w-full text-left px-2 py-2.5 text-sm font-medium hover:bg-gray-50 rounded-lg"
                >
                  {s.nombre}
                </button>
              </li>
            ))}
            {salonesFiltrados.length === 0 && (
              <li className="text-sm text-gray-400 text-center py-4">
                {cargandoSalones ? 'Cargando…' : busquedaSalon ? 'No encontramos ese salón.' : 'No hay salones disponibles.'}
              </li>
            )}
          </ul>

          <p className="text-center text-sm text-gray-500">
            ¿Ya tienes cuenta?{' '}
            <button type="button" onClick={irALogin} className="text-brand-600 font-medium">Inicia sesión</button>
          </p>
          <p className="text-center text-[11px] text-gray-300">Developed by Vulpex Software SAS</p>
        </div>
      </div>
    )
  }

  if (listo === 'sesion') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 text-center space-y-3">
          <p className="text-brand-700 font-semibold">¡Cuenta creada!</p>
          <p className="text-sm text-gray-500">Ya puedes solicitar tu cita. Recuerda tu usuario y contraseña para la próxima vez.</p>
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
          <p className="text-sm text-gray-500">Ya puedes iniciar sesión con el usuario y la contraseña que elegiste.</p>
          <button onClick={irALogin} className="inline-block bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium">Iniciar sesión</button>
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Nombre</label>
            <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Apellido</label>
            <input required value={apellidos} onChange={(e) => setApellidos(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Teléfono (WhatsApp)</label>
          <input
            required
            inputMode="tel"
            value={telefono}
            onChange={(e) => cambiarTelefono(e.target.value)}
            placeholder="3001234567"
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Usuario</label>
          <input
            required
            autoCapitalize="none"
            value={usuario}
            onChange={(e) => { setUsuario(e.target.value); setUsuarioTocado(true) }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
          <p className="text-xs text-gray-400 mt-1">Se llena solo con tu teléfono, pero lo puedes cambiar.</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Contraseña</label>
          <input
            required
            minLength={6}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setPasswordTocado(true) }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
          <p className="text-xs text-gray-400 mt-1">También se llena con tu teléfono -- cámbiala si quieres una tuya (mínimo 6 caracteres).</p>
        </div>

        <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
          {loading ? 'Creando…' : 'Crear cuenta'}
        </button>

        <p className="text-center text-sm text-gray-500">
          ¿Ya tienes cuenta?{' '}
          <button type="button" onClick={irALogin} className="text-brand-600 font-medium">Inicia sesión</button>
        </p>
        <p className="text-center text-[11px] text-gray-300">Developed by Vulpex Software SAS</p>
      </form>
    </div>
  )
}
