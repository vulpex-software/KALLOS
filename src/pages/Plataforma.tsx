import { useEffect, useState, type FormEvent } from 'react'
import { supabase, crearClienteEfimero } from '../lib/supabaseClient'
import { normalizarCorreoOUsuario } from '../lib/authDominio'
import { generarSlug } from '../lib/slug'
import { coloresContrastanPoco } from '../lib/theme'
import type { ResumenSalon, SalonPago } from '../types'

const PLANES: { valor: ResumenSalon['plan']; etiqueta: string }[] = [
  { valor: 'basico', etiqueta: 'Básico' },
  { valor: 'pro', etiqueta: 'Pro' },
  { valor: 'enterprise', etiqueta: 'Enterprise' }
]

// Pares principal+secundario ya armados para un clic -- pensados para que
// contrasten bien sin que el operador tenga que salir a buscar hex en
// internet (ver theme.ts: el principal sigue siendo el que manda oscuro/
// claro para el sidebar, el secundario es el que se aclara/oscurece para
// el fondo de página).
const PALETA_SUGERIDA: { nombre: string; primario: string; secundario: string }[] = [
  { nombre: 'Dorado KALLOS', primario: '#0B0B0D', secundario: '#D4AF37' },
  { nombre: 'Azul noche', primario: '#16294A', secundario: '#DBEAFE' },
  { nombre: 'Esmeralda', primario: '#064E3B', secundario: '#D1FAE5' },
  { nombre: 'Burdeos', primario: '#4C0519', secundario: '#FBCFE8' },
  { nombre: 'Ciruela', primario: '#3B0764', secundario: '#EDE9FE' },
  { nombre: 'Terracota', primario: '#7C2D12', secundario: '#FFEDD5' },
  { nombre: 'Grafito', primario: '#1F2937', secundario: '#E2E8F0' },
  { nombre: 'Petróleo', primario: '#0C4A6E', secundario: '#CFFAFE' }
]

// Rojo si ya venció, ámbar si vence en 7 días o menos, verde si falta más
// (o si todavía no se ha fijado ninguna fecha).
function colorVencimiento(fecha: string | null): { clase: string; texto: string } {
  if (!fecha) return { clase: 'bg-gray-100 text-gray-500', texto: 'Sin fecha' }
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const venc = new Date(fecha + 'T00:00:00')
  const dias = Math.round((venc.getTime() - hoy.getTime()) / 86400000)
  const texto = venc.toLocaleDateString('es-CO')
  if (dias < 0) return { clase: 'bg-red-100 text-red-700', texto: `Venció ${texto}` }
  if (dias <= 7) return { clase: 'bg-amber-100 text-amber-700', texto: `Vence ${texto}` }
  return { clase: 'bg-green-100 text-green-700', texto: `Vence ${texto}` }
}

interface KitEntrega {
  salonNombre: string
  urlApp: string
  usuario: string
  password: string
  linkRegistro: string
}

export default function Plataforma() {
  const [salones, setSalones] = useState<ResumenSalon[]>([])
  const [cargando, setCargando] = useState(true)

  async function cargar() {
    const { data, error } = await supabase.rpc('plataforma_resumen_salones')
    if (!error) {
      // El salón especial "KALLOS Plataforma" no es un cliente: no va en la cartera.
      setSalones(((data as ResumenSalon[]) ?? []).filter((s) => s.slug !== 'plataforma'))
    }
    setCargando(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  // --- Crear salón nuevo ---
  const [mostrarAlta, setMostrarAlta] = useState(false)
  const [nNombre, setNNombre] = useState('')
  const [nSlug, setNSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)
  const [nPlan, setNPlan] = useState<ResumenSalon['plan']>('basico')
  const [nContactoNombre, setNContactoNombre] = useState('')
  const [nContactoTelefono, setNContactoTelefono] = useState('')
  const [nContactoCorreo, setNContactoCorreo] = useState('')
  const [nNotas, setNNotas] = useState('')
  const [nUsuario, setNUsuario] = useState('')
  const [nPassword, setNPassword] = useState('')
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kit, setKit] = useState<KitEntrega | null>(null)
  const [copiado, setCopiado] = useState(false)

  function cambiarNombre(v: string) {
    setNNombre(v)
    if (!slugTocado) setNSlug(generarSlug(v))
  }

  async function crearSalon(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setKit(null)

    const slug = generarSlug(nSlug)
    if (!slug) { setError('El slug no puede quedar vacío.'); return }
    if (nPassword.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return }
    setCreando(true)

    // 1. El salón.
    const { data: salonNuevo, error: errSalon } = await supabase
      .from('salones')
      .insert({ nombre: nNombre.trim(), slug, dominio_interno: `${slug}.kallos.app`, plan: nPlan })
      .select()
      .single()
    if (errSalon || !salonNuevo) {
      setCreando(false)
      setError(
        errSalon?.message.toLowerCase().includes('duplicate') || errSalon?.message.toLowerCase().includes('unique')
          ? 'Ya existe un salón con ese slug. Cambia el slug e intenta de nuevo.'
          : 'No se pudo crear el salón: ' + (errSalon?.message ?? '')
      )
      return
    }

    // 2. Los datos de la venta (a quién se lo vendiste).
    await supabase.from('salones_detalle_venta').insert({
      salon_id: salonNuevo.id,
      contacto_nombre: nContactoNombre.trim() || null,
      contacto_telefono: nContactoTelefono.trim() || null,
      contacto_correo: nContactoCorreo.trim() || null,
      notas: nNotas.trim() || null
    })

    // 3. El superadmin del salón (cliente efímero: no cierra tu sesión de operador).
    const email = normalizarCorreoOUsuario(nUsuario)
    const efimero = crearClienteEfimero()
    const { data: signup, error: errSignup } = await efimero.auth.signUp({
      email,
      password: nPassword,
      options: { data: { nombre: nContactoNombre.trim() || nNombre.trim(), salon_id: salonNuevo.id } }
    })
    if (errSignup || !signup.user) {
      setCreando(false)
      setError(
        errSignup?.message.toLowerCase().includes('registered') || errSignup?.message.toLowerCase().includes('already')
          ? 'Ese usuario/correo ya existe. El salón quedó creado; crea el acceso con otro usuario editando el salón.'
          : 'El salón quedó creado pero no se pudo crear el usuario: ' + (errSignup?.message ?? '')
      )
      cargar()
      return
    }

    // 4. Promoverlo a superadmin de SU salón (RPC de operador).
    const { error: errPromo } = await supabase.rpc('plataforma_promover_superadmin', { p_user_id: signup.user.id })
    setCreando(false)
    if (errPromo) {
      setError('El salón y el usuario quedaron creados, pero falló la promoción a superadmin: ' + errPromo.message)
      cargar()
      return
    }

    // 5. Kit de entrega listo para copiar y mandarle al cliente.
    setKit({
      salonNombre: nNombre.trim(),
      urlApp: window.location.origin,
      usuario: email.includes('@' ) && !nUsuario.includes('@') ? nUsuario.trim().toLowerCase() : email,
      password: nPassword,
      linkRegistro: `${window.location.origin}/registro-cliente/${slug}`
    })
    setNNombre(''); setNSlug(''); setSlugTocado(false); setNPlan('basico')
    setNContactoNombre(''); setNContactoTelefono(''); setNContactoCorreo(''); setNNotas('')
    setNUsuario(''); setNPassword('')
    setMostrarAlta(false)
    cargar()
  }

  async function copiarKit() {
    if (!kit) return
    const texto = [
      `Bienvenida a KALLOS — ${kit.salonNombre}`,
      ``,
      `App: ${kit.urlApp}`,
      `Usuario: ${kit.usuario}`,
      `Contraseña temporal: ${kit.password} (cámbiala al entrar, en Usuarios)`,
      ``,
      `Link de registro para tus clientas (compártelo por WhatsApp o en QR):`,
      kit.linkRegistro
    ].join('\n')
    await navigator.clipboard.writeText(texto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  // --- Edición por salón ---
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [eContactoNombre, setEContactoNombre] = useState('')
  const [eContactoTelefono, setEContactoTelefono] = useState('')
  const [eContactoCorreo, setEContactoCorreo] = useState('')
  const [eNotas, setENotas] = useState('')
  const [eColor, setEColor] = useState('')
  const [eColor2, setEColor2] = useState('')
  const [eEslogan, setEEslogan] = useState('')
  const [eNombre, setENombre] = useState('')
  const [eError, setEError] = useState<string | null>(null)
  const [eAvisoContraste, setEAvisoContraste] = useState<string | null>(null)

  function abrirEdicion(s: ResumenSalon) {
    if (editandoId === s.id) { setEditandoId(null); return }
    setEditandoId(s.id)
    setEError(null)
    setEAvisoContraste(null)
    setEContactoNombre(s.contacto_nombre ?? '')
    setEContactoTelefono(s.contacto_telefono ?? '')
    setEContactoCorreo(s.contacto_correo ?? '')
    setENotas(s.notas ?? '')
    setEColor(s.color_primario ?? '')
    setEColor2(s.color_secundario ?? '')
    setEEslogan(s.eslogan ?? '')
    setENombre(s.nombre)
  }

  async function guardarEdicion(s: ResumenSalon) {
    setEError(null)
    setEAvisoContraste(null)
    const color = eColor.trim()
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      setEError('El color principal debe ser un hex de 6 dígitos, ej. #16294A (o vacío para usar el dorado de KALLOS).')
      return
    }
    const color2 = eColor2.trim()
    if (color2 && !/^#[0-9a-fA-F]{6}$/.test(color2)) {
      setEError('El color secundario debe ser un hex de 6 dígitos, ej. #DBEAFE (o vacío para usar el mismo principal).')
      return
    }
    if (color && color2 && coloresContrastanPoco(color, color2)) {
      setEAvisoContraste('Los dos colores quedan bastante parecidos en claridad — para que se noten los dos (como el ejemplo azul oscuro + azul claro), prueba que uno sea claramente más claro que el otro.')
    }
    const eslogan = eEslogan.trim()
    if (eslogan.length > 80) {
      setEError('El eslogan debe tener máximo 80 caracteres.')
      return
    }
    const nombre = eNombre.trim()
    if (!nombre) {
      setEError('El nombre del salón no puede quedar vacío.')
      return
    }
    const { error: e1 } = await supabase
      .from('salones')
      .update({ color_primario: color || null, color_secundario: color2 || null, eslogan: eslogan || null, nombre })
      .eq('id', s.id)
    const { error: e2 } = await supabase
      .from('salones_detalle_venta')
      .upsert({
        salon_id: s.id,
        contacto_nombre: eContactoNombre.trim() || null,
        contacto_telefono: eContactoTelefono.trim() || null,
        contacto_correo: eContactoCorreo.trim() || null,
        notas: eNotas.trim() || null,
        updated_at: new Date().toISOString()
      })
    if (e1 || e2) { setEError('No se pudo guardar: ' + (e1?.message ?? e2?.message)); return }
    setEditandoId(null)
    cargar()
  }

  async function cambiarPlan(s: ResumenSalon, plan: ResumenSalon['plan']) {
    await supabase.from('salones').update({ plan }).eq('id', s.id)
    cargar()
  }

  // --- Logo propio (Pro/Enterprise; ver src/lib/branding.ts para el gate) ---
  const [subiendoLogoId, setSubiendoLogoId] = useState<string | null>(null)

  async function subirLogo(s: ResumenSalon, archivo: File) {
    setEError(null)
    setSubiendoLogoId(s.id)
    const ext = archivo.name.split('.').pop()?.toLowerCase() || 'png'
    const ruta = `${s.id}/logo.${ext}`
    const { error: errSubida } = await supabase.storage
      .from('logos')
      .upload(ruta, archivo, { upsert: true, cacheControl: '3600' })
    if (errSubida) {
      setSubiendoLogoId(null)
      setEError('No se pudo subir el logo: ' + errSubida.message)
      return
    }
    const { data } = supabase.storage.from('logos').getPublicUrl(ruta)
    // Cache-busting: la misma ruta puede haber quedado cacheada por el navegador.
    const url = `${data.publicUrl}?v=${Date.now()}`
    const { error: errUpdate } = await supabase.from('salones').update({ logo_url: url }).eq('id', s.id)
    setSubiendoLogoId(null)
    if (errUpdate) { setEError('El logo se subió pero no se pudo guardar: ' + errUpdate.message); return }
    cargar()
  }

  async function alternarActivo(s: ResumenSalon) {
    if (s.activo && !confirm(`¿Suspender "${s.nombre}"? Nadie de ese salón podrá registrarse por su link mientras esté suspendido.`)) return
    await supabase.from('salones').update({ activo: !s.activo }).eq('id', s.id)
    cargar()
  }

  // --- Pagos (organiza el cobro manual, sin Stripe) ---
  const [pagosAbiertoId, setPagosAbiertoId] = useState<string | null>(null)
  const [pagos, setPagos] = useState<SalonPago[]>([])
  const [pVencimiento, setPVencimiento] = useState('')
  const [pMonto, setPMonto] = useState('')
  const [pFecha, setPFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [pMetodo, setPMetodo] = useState('')
  const [pNota, setPNota] = useState('')
  const [pError, setPError] = useState<string | null>(null)
  const [registrandoPago, setRegistrandoPago] = useState(false)

  async function abrirPagos(s: ResumenSalon) {
    if (pagosAbiertoId === s.id) { setPagosAbiertoId(null); return }
    setPagosAbiertoId(s.id)
    setPError(null)
    setPVencimiento(s.fecha_proximo_vencimiento ?? '')
    setPMonto(''); setPFecha(new Date().toISOString().slice(0, 10)); setPMetodo(''); setPNota('')
    const { data } = await supabase
      .from('salones_pagos')
      .select('*')
      .eq('salon_id', s.id)
      .order('fecha_pago', { ascending: false })
      .limit(5)
    setPagos((data as SalonPago[]) ?? [])
  }

  async function guardarVencimiento(s: ResumenSalon) {
    setPError(null)
    await supabase
      .from('salones_detalle_venta')
      .upsert({ salon_id: s.id, fecha_proximo_vencimiento: pVencimiento || null, updated_at: new Date().toISOString() })
    cargar()
  }

  async function registrarPago(s: ResumenSalon, e: FormEvent) {
    e.preventDefault()
    setPError(null)
    const monto = Number(pMonto)
    if (!monto || monto <= 0) { setPError('Escribe un monto válido.'); return }
    setRegistrandoPago(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error: errPago } = await supabase.from('salones_pagos').insert({
      salon_id: s.id,
      monto,
      fecha_pago: pFecha,
      metodo_pago: pMetodo.trim() || null,
      nota: pNota.trim() || null,
      registrado_por: user?.id
    })
    setRegistrandoPago(false)
    if (errPago) { setPError('No se pudo registrar el pago: ' + errPago.message); return }
    setPMonto(''); setPNota('')
    abrirPagos(s)
    cargar()
  }

  // --- Acceso de la dueña (soporte: restablecer usuario/contraseña) ---
  const [accesoAbiertoId, setAccesoAbiertoId] = useState<string | null>(null)
  const [aNuevoUsuario, setANuevoUsuario] = useState('')
  const [aNuevaPassword, setANuevaPassword] = useState('')
  const [aError, setAError] = useState<string | null>(null)
  const [aMensaje, setAMensaje] = useState<string | null>(null)
  const [guardandoAccesoDueña, setGuardandoAccesoDueña] = useState(false)

  function abrirAccesoDueña(s: ResumenSalon) {
    if (accesoAbiertoId === s.id) { setAccesoAbiertoId(null); return }
    setAccesoAbiertoId(s.id)
    setANuevoUsuario('')
    setANuevaPassword('')
    setAError(null)
    setAMensaje(null)
  }

  async function restablecerAccesoDueña(s: ResumenSalon) {
    setAError(null)
    setAMensaje(null)
    if (!aNuevoUsuario.trim() && !aNuevaPassword.trim()) {
      setAError('Escribe un nuevo usuario/correo o una nueva contraseña.')
      return
    }
    if (aNuevaPassword.trim() && aNuevaPassword.trim().length < 6) {
      setAError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    setGuardandoAccesoDueña(true)
    const { error } = await supabase.rpc('plataforma_resetear_acceso_superadmin', {
      p_salon_id: s.id,
      p_nuevo_usuario: aNuevoUsuario.trim() || null,
      p_nueva_password: aNuevaPassword.trim() || null
    })
    setGuardandoAccesoDueña(false)
    if (error) {
      setAError(
        error.message.toLowerCase().includes('duplicate') || error.message.toLowerCase().includes('unique')
          ? 'Ese usuario/correo ya está en uso por otra cuenta.'
          : 'No se pudo actualizar: ' + error.message
      )
      return
    }
    setAMensaje(
      'Acceso actualizado.' +
        (aNuevoUsuario.trim() ? ` Su usuario para entrar es exactamente: ${aNuevoUsuario.trim()}.` : '') +
        ' Avísale a la dueña su nuevo usuario/contraseña.'
    )
    setANuevoUsuario('')
    setANuevaPassword('')
  }

  // --- Entrar como (soporte) ---
  const [impersonando, setImpersonando] = useState<string | null>(null)
  const [errorImpersonar, setErrorImpersonar] = useState<string | null>(null)

  async function entrarComo(s: ResumenSalon) {
    if (!confirm(`Vas a entrar con la sesión real de "${s.nombre}". Al salir, vas a tener que volver a iniciar sesión con tu clave de operador. ¿Continuar?`)) return
    setErrorImpersonar(null)
    setImpersonando(s.id)
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/plataforma-impersonar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ salon_id: s.id })
      })
      const body = await resp.json()
      if (!resp.ok) { setErrorImpersonar(body.error ?? 'No se pudo entrar a ese salón.'); setImpersonando(null); return }
      const { error: errOtp } = await supabase.auth.verifyOtp({ token_hash: body.hashed_token, type: 'magiclink' })
      if (errOtp) { setErrorImpersonar(errOtp.message); setImpersonando(null); return }
      sessionStorage.setItem('kallos_impersonando', body.salon_nombre)
      window.location.href = '/'
    } catch {
      setErrorImpersonar('No se pudo conectar con el servidor de soporte.')
      setImpersonando(null)
    }
  }

  const activos = salones.filter((s) => s.activo).length

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Consola KALLOS</h1>
          <p className="text-xs text-gray-400">
            {salones.length} {salones.length === 1 ? 'salón vendido' : 'salones vendidos'} · {activos} {activos === 1 ? 'activo' : 'activos'}
          </p>
        </div>
        <button
          onClick={() => { setMostrarAlta((v) => !v); setError(null); setKit(null) }}
          className="text-sm bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg px-3 py-1.5"
        >
          {mostrarAlta ? 'Cerrar' : '+ Vender / crear salón'}
        </button>
      </div>

      {kit && (
        <div className="bg-ink text-gray-100 rounded-2xl p-4 space-y-3 border border-brand-700/40">
          <p className="text-sm font-semibold text-brand-300">Kit de entrega — {kit.salonNombre}</p>
          <pre className="text-xs whitespace-pre-wrap bg-surface rounded-lg p-3 border border-gray-700">
{`App: ${kit.urlApp}
Usuario: ${kit.usuario}
Contraseña temporal: ${kit.password}
Registro de clientas: ${kit.linkRegistro}`}
          </pre>
          <div className="flex gap-2">
            <button onClick={copiarKit} className="flex-1 bg-brand-500 hover:bg-brand-600 text-ink text-sm font-semibold rounded-lg py-2">
              {copiado ? '¡Copiado!' : 'Copiar kit para enviarlo'}
            </button>
            <button onClick={() => setKit(null)} className="px-4 text-sm text-gray-400">Cerrar</button>
          </div>
          <p className="text-[11px] text-gray-500">
            La contraseña es temporal: pídele al cliente cambiarla al entrar (pantalla Usuarios → Usuario / contraseña).
          </p>
        </div>
      )}

      {mostrarAlta && (
        <form onSubmit={crearSalon} className="bg-white rounded-2xl shadow p-4 space-y-3">
          <h2 className="font-semibold text-sm text-gray-600">Nuevo salón (cliente)</h2>
          {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Nombre del salón</label>
              <input required value={nNombre} onChange={(e) => cambiarNombre(e.target.value)} placeholder="Laura's Spa" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Slug (URL)</label>
              <input required value={nSlug} onChange={(e) => { setNSlug(e.target.value); setSlugTocado(true) }} placeholder="lauras-spa" className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm" />
              <p className="text-xs text-gray-400 mt-1">Registro de clientas: /registro-cliente/{generarSlug(nSlug) || '…'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Plan</label>
              <select value={nPlan} onChange={(e) => setNPlan(e.target.value as ResumenSalon['plan'])} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                {PLANES.map((p) => <option key={p.valor} value={p.valor}>{p.etiqueta}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Contacto (dueña)</label>
              <input value={nContactoNombre} onChange={(e) => setNContactoNombre(e.target.value)} placeholder="Laura Gómez" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Teléfono</label>
              <input value={nContactoTelefono} onChange={(e) => setNContactoTelefono(e.target.value)} placeholder="3001234567" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Correo del contacto</label>
              <input type="email" value={nContactoCorreo} onChange={(e) => setNContactoCorreo(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notas de la venta</label>
              <input value={nNotas} onChange={(e) => setNNotas(e.target.value)} placeholder="Ej. paga por transferencia el 1 de cada mes" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-semibold text-gray-500 mb-2">Acceso superadmin del salón (para entregarle al cliente)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Usuario o correo</label>
                <input required autoCapitalize="none" value={nUsuario} onChange={(e) => setNUsuario(e.target.value)} placeholder="laura  (o laura@correo.com)" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Contraseña temporal</label>
                <input type="text" required minLength={6} value={nPassword} onChange={(e) => setNPassword(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
              </div>
            </div>
          </div>

          <button type="submit" disabled={creando} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
            {creando ? 'Creando salón…' : 'Crear salón y generar kit de entrega'}
          </button>
        </form>
      )}

      {cargando && <p className="text-sm text-gray-400 p-3">Cargando cartera…</p>}

      <div className="space-y-3">
        {salones.map((s) => (
          <div key={s.id} className={`bg-white rounded-2xl shadow p-4 space-y-3 ${s.activo ? '' : 'opacity-60'}`}>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {s.nombre}
                  <span className="text-gray-400 font-normal text-xs ml-2 font-mono">/{s.slug}</span>
                </p>
                <p className="text-xs text-gray-400">
                  Desde {new Date(s.created_at).toLocaleDateString('es-CO')} · {s.total_personal} de personal · {s.total_clientes} clientas
                  {s.contacto_nombre && <> · {s.contacto_nombre}{s.contacto_telefono ? ` (${s.contacto_telefono})` : ''}</>}
                </p>
              </div>
              {(() => { const v = colorVencimiento(s.fecha_proximo_vencimiento); return (
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${v.clase}`}>{v.texto}</span>
              ) })()}
              <select
                value={s.plan}
                onChange={(e) => cambiarPlan(s, e.target.value as ResumenSalon['plan'])}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                {PLANES.map((p) => <option key={p.valor} value={p.valor}>{p.etiqueta}</option>)}
              </select>
              <button
                onClick={() => alternarActivo(s)}
                className={`text-xs px-2 py-1 rounded-full ${s.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
              >
                {s.activo ? 'Activo' : 'Suspendido'}
              </button>
              <button
                onClick={() => entrarComo(s)}
                disabled={impersonando === s.id}
                title="Entrar con la sesión real del superadmin, para soporte"
                className="text-xs px-2 py-1 rounded-full bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {impersonando === s.id ? 'Entrando…' : 'Entrar como'}
              </button>
            </div>

            {errorImpersonar && pagosAbiertoId !== s.id && editandoId !== s.id && accesoAbiertoId !== s.id && (
              <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{errorImpersonar}</div>
            )}

            <div className="pt-1 border-t border-gray-50 space-y-2">
              <div className="flex flex-wrap gap-3">
                <button onClick={() => abrirEdicion(s)} className="text-xs text-brand-600 font-medium">
                  {editandoId === s.id ? 'Cerrar ▲' : 'Contacto, notas y marca ▾'}
                </button>
                <button onClick={() => abrirPagos(s)} className="text-xs text-brand-600 font-medium">
                  {pagosAbiertoId === s.id ? 'Cerrar ▲' : 'Pagos y vencimiento ▾'}
                </button>
                <button onClick={() => abrirAccesoDueña(s)} className="text-xs text-brand-600 font-medium">
                  {accesoAbiertoId === s.id ? 'Cerrar ▲' : 'Acceso de la dueña ▾'}
                </button>
              </div>

              {accesoAbiertoId === s.id && (
                <div className="space-y-2 bg-gray-50 rounded-lg p-2">
                  <p className="text-xs text-gray-500">
                    Restablece el usuario/contraseña de la superadmin de este salón -- para cuando quedó bloqueada y no hay nadie más en su salón que pueda cambiárselo.
                  </p>
                  {aError && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{aError}</div>}
                  {aMensaje && <div className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{aMensaje}</div>}
                  <input
                    autoCapitalize="none"
                    placeholder="Nuevo usuario o correo (dejar vacío para no cambiar)"
                    value={aNuevoUsuario}
                    onChange={(e) => setANuevoUsuario(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="text"
                    minLength={6}
                    placeholder="Nueva contraseña (dejar vacío para no cambiar)"
                    value={aNuevaPassword}
                    onChange={(e) => setANuevaPassword(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => restablecerAccesoDueña(s)}
                    disabled={guardandoAccesoDueña}
                    className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-1.5"
                  >
                    {guardandoAccesoDueña ? 'Actualizando…' : 'Restablecer acceso'}
                  </button>
                </div>
              )}

              {pagosAbiertoId === s.id && (
                <div className="space-y-2 bg-gray-50 rounded-lg p-2">
                  {pError && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{pError}</div>}
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Próximo vencimiento</label>
                      <input type="date" value={pVencimiento} onChange={(e) => setPVencimiento(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    </div>
                    <button onClick={() => guardarVencimiento(s)} className="text-xs bg-gray-700 text-white rounded-lg px-3 py-1.5">Guardar fecha</button>
                  </div>

                  <form onSubmit={(e) => registrarPago(s, e)} className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-gray-200">
                    <input required type="number" min="1" step="1" placeholder="Monto" value={pMonto} onChange={(e) => setPMonto(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    <input type="date" value={pFecha} onChange={(e) => setPFecha(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    <input placeholder="Método (ej. Nequi)" value={pMetodo} onChange={(e) => setPMetodo(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    <input placeholder="Nota" value={pNota} onChange={(e) => setPNota(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    <button type="submit" disabled={registrandoPago} className="col-span-2 sm:col-span-4 bg-brand-600 text-white text-sm rounded-lg py-1.5 font-medium disabled:opacity-60">
                      {registrandoPago ? 'Registrando…' : 'Registrar pago'}
                    </button>
                  </form>

                  {pagos.length > 0 && (
                    <ul className="text-xs text-gray-500 divide-y divide-gray-200 pt-1">
                      {pagos.map((pg) => (
                        <li key={pg.id} className="py-1 flex justify-between">
                          <span>{new Date(pg.fecha_pago + 'T00:00:00').toLocaleDateString('es-CO')}{pg.metodo_pago ? ` · ${pg.metodo_pago}` : ''}{pg.nota ? ` · ${pg.nota}` : ''}</span>
                          <span className="font-medium text-gray-700">${pg.monto.toLocaleString('es-CO')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {editandoId === s.id && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {eError && <div className="sm:col-span-2 text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{eError}</div>}
                  {s.plan === 'basico' && (
                    <p className="sm:col-span-2 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg p-2">
                      Nombre propio, colores, logo y eslogan solo se ven en planes Pro/Enterprise — en Básico este salón siempre muestra la marca KALLOS, aunque los guardes acá.
                    </p>
                  )}
                  <input placeholder="Nombre del salón (lo ve la clienta en Pro/Enterprise)" value={eNombre} onChange={(e) => setENombre(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm sm:col-span-2" />
                  <input placeholder="Contacto (dueña)" value={eContactoNombre} onChange={(e) => setEContactoNombre(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  <input placeholder="Teléfono" value={eContactoTelefono} onChange={(e) => setEContactoTelefono(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  <input placeholder="Correo" value={eContactoCorreo} onChange={(e) => setEContactoCorreo(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  <div className="flex items-center gap-2">
                    <input placeholder="Color principal, ej. #16294A" value={eColor} onChange={(e) => setEColor(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono" />
                    <input
                      type="color"
                      title="Elegir color principal"
                      value={/^#[0-9a-fA-F]{6}$/.test(eColor.trim()) ? eColor.trim() : '#000000'}
                      onChange={(e) => setEColor(e.target.value)}
                      className="w-9 h-9 shrink-0 rounded border border-gray-300 p-0.5 cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input placeholder="Color secundario, ej. #DBEAFE" value={eColor2} onChange={(e) => setEColor2(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-mono" />
                    <input
                      type="color"
                      title="Elegir color secundario"
                      value={/^#[0-9a-fA-F]{6}$/.test(eColor2.trim()) ? eColor2.trim() : '#ffffff'}
                      onChange={(e) => setEColor2(e.target.value)}
                      className="w-9 h-9 shrink-0 rounded border border-gray-300 p-0.5 cursor-pointer"
                    />
                  </div>
                  <div className="sm:col-span-2 flex flex-wrap gap-2">
                    {PALETA_SUGERIDA.map((par) => (
                      <button
                        key={par.nombre}
                        type="button"
                        title={par.nombre}
                        onClick={() => { setEColor(par.primario); setEColor2(par.secundario); setEAvisoContraste(null) }}
                        className="w-8 h-8 rounded-full border border-gray-200 overflow-hidden shrink-0"
                        style={{ background: `linear-gradient(135deg, ${par.primario} 50%, ${par.secundario} 50%)` }}
                      />
                    ))}
                  </div>
                  <p className="sm:col-span-2 text-[11px] text-gray-400 -mt-1">
                    El principal es el fondo del menú del salón; el secundario resalta encima de ese fondo (deja los dos vacíos para el negro+dorado de KALLOS). Usa el cuadrito de color o uno de los pares de arriba — ya vienen armados para que contrasten bien.
                  </p>
                  {eAvisoContraste && <p className="sm:col-span-2 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg p-2">{eAvisoContraste}</p>}
                  <input placeholder="Eslogan propio, ej. Belleza con alma (vacío = el de KALLOS)" maxLength={80} value={eEslogan} onChange={(e) => setEEslogan(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm sm:col-span-2" />
                  <textarea placeholder="Notas de la venta / acuerdos de pago" value={eNotas} onChange={(e) => setENotas(e.target.value)} rows={2} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm sm:col-span-2 resize-none" />
                  <button onClick={() => guardarEdicion(s)} className="sm:col-span-2 bg-brand-600 text-white text-sm rounded-lg py-1.5 font-medium">Guardar</button>

                  <div className="sm:col-span-2 flex items-center gap-3 pt-2 border-t border-gray-100">
                    {s.logo_url && <img src={s.logo_url} alt="" className="w-10 h-10 object-contain rounded border border-gray-200" />}
                    <label className="flex-1 text-xs text-gray-500">
                      Logo del salón (PNG/JPG)
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml"
                        disabled={subiendoLogoId === s.id}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) subirLogo(s, f); e.target.value = '' }}
                        className="block w-full text-xs mt-1"
                      />
                    </label>
                    {subiendoLogoId === s.id && <span className="text-xs text-gray-400">Subiendo…</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {!cargando && salones.length === 0 && (
          <p className="text-sm text-gray-400 p-3">Todavía no has vendido ningún salón. Crea el primero con "+ Vender / crear salón".</p>
        )}
      </div>
    </div>
  )
}
