import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase, crearClienteEfimero } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { normalizarCorreoOUsuario } from '../lib/authDominio'
import { ESPECIALIDADES, type Especialidad, type Profile, type Rol } from '../types'

const ROLES: { valor: Rol; etiqueta: string }[] = [
  { valor: 'cliente', etiqueta: 'Clienta' },
  { valor: 'personal', etiqueta: 'Personal (profesional)' },
  { valor: 'admin', etiqueta: 'Admin' },
  { valor: 'superadmin', etiqueta: 'Super Admin (Dueña)' }
]

export default function Usuarios() {
  const { profile } = useAuth()
  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [filtro, setFiltro] = useState('')
  const [pestana, setPestana] = useState<'personal' | 'clientes'>('personal')

  // --- Alta de usuario nuevo ---
  const [mostrarAlta, setMostrarAlta] = useState(false)
  const [nNombre, setNNombre] = useState('')
  const [nUsuario, setNUsuario] = useState('')
  const [nPassword, setNPassword] = useState('')
  const [nTelefono, setNTelefono] = useState('')
  const [nRol, setNRol] = useState<Rol>('personal')
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Feedback de acciones sobre una fila (borrar cuenta) -- separado del
  // error/mensaje de arriba porque ese vive DENTRO del form colapsable de
  // "Crear usuario" y no se ve si el form está cerrado.
  const [accionError, setAccionError] = useState<string | null>(null)
  const [accionMensaje, setAccionMensaje] = useState<string | null>(null)

  async function cargar() {
    const { data } = await supabase.from('profiles').select('*').order('nombre')
    setPerfiles((data as Profile[]) ?? [])
  }

  useEffect(() => {
    cargar()
  }, [])

  async function crearUsuario(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMensaje(null)
    setCreando(true)

    if (!profile?.salon_id) {
      setCreando(false)
      setError('No se pudo determinar tu salón. Vuelve a iniciar sesión e intenta de nuevo.')
      return
    }

    const email = normalizarCorreoOUsuario(nUsuario)
    // Cliente efímero: crea la cuenta sin cerrar la sesión del superadmin.
    const efimero = crearClienteEfimero()
    const { data, error: errSignup } = await efimero.auth.signUp({
      email,
      password: nPassword,
      // El nuevo usuario hereda el salón de quien lo está creando.
      options: { data: { nombre: nNombre, telefono: nTelefono, salon_id: profile.salon_id } }
    })

    if (errSignup) {
      setCreando(false)
      setError(
        errSignup.message.toLowerCase().includes('registered') || errSignup.message.toLowerCase().includes('already')
          ? 'Ese usuario/correo ya existe.'
          : 'No se pudo crear el usuario: ' + errSignup.message
      )
      return
    }

    // El trigger creó su perfil como 'cliente'. Le ponemos el rol elegido.
    const nuevoId = data.user?.id
    if (nuevoId) {
      await supabase
        .from('profiles')
        .update({ rol: nRol, nombre: nNombre, telefono: nTelefono || null })
        .eq('id', nuevoId)
    }

    setCreando(false)
    if (!data.session) {
      // La confirmación de correo está activada en Supabase.
      setMensaje(
        'Usuario creado, pero Supabase pide confirmar el correo. Para cuentas internas, desactiva ' +
          '"Confirm email" en Supabase → Authentication → Providers → Email, y vuelve a crearlo.'
      )
    } else {
      setMensaje(`Usuario "${nNombre}" creado. Ya puede iniciar sesión con ${email.split('@')[0]}.`)
    }

    setNNombre('')
    setNUsuario('')
    setNPassword('')
    setNTelefono('')
    setNRol('personal')
    cargar()
  }

  async function cambiarRol(id: string, rol: Rol) {
    await supabase.from('profiles').update({ rol }).eq('id', id)
    cargar()
  }

  async function alternarActivo(p: Profile) {
    if (p.activo && !confirm(`¿Quitar el acceso a ${p.nombre}? No podrá iniciar sesión hasta reactivarla.`)) return
    await supabase.from('profiles').update({ activo: !p.activo }).eq('id', p.id)
    cargar()
  }

  async function alternarEspecialidad(p: Profile, esp: Especialidad) {
    const actuales = p.especialidades ?? []
    const nuevas = actuales.includes(esp)
      ? actuales.filter((e) => e !== esp)
      : [...actuales, esp]
    await supabase.from('profiles').update({ especialidades: nuevas }).eq('id', p.id)
    cargar()
  }

  // --- Editar datos básicos (#8) ---
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [datos, setDatos] = useState<Partial<Profile>>({})
  const [datosError, setDatosError] = useState<string | null>(null)

  function abrirDatos(p: Profile) {
    if (editandoId === p.id) { setEditandoId(null); return }
    setEditandoId(p.id)
    setDatosError(null)
    setDatos({
      nombre: p.nombre,
      telefono: p.telefono ?? '',
      apellidos: p.apellidos ?? '',
      cedula: p.cedula ?? '',
      correo: p.correo ?? '',
      direccion: p.direccion ?? '',
      fecha_nacimiento: p.fecha_nacimiento ?? '',
      fecha_ingreso: p.fecha_ingreso ?? ''
    })
  }

  async function guardarDatos(id: string) {
    const nombreLimpio = (datos.nombre ?? '').trim()
    if (!nombreLimpio) { setDatosError('El nombre no puede quedar vacío.'); return }
    const limpio: Partial<Profile> = {
      ...datos,
      nombre: nombreLimpio,
      telefono: datos.telefono || null,
      apellidos: datos.apellidos || null,
      cedula: datos.cedula || null,
      correo: datos.correo || null,
      direccion: datos.direccion || null,
      fecha_nacimiento: datos.fecha_nacimiento || null,
      fecha_ingreso: datos.fecha_ingreso || null
    }
    const { error } = await supabase.from('profiles').update(limpio).eq('id', id)
    if (error) { setDatosError('No se pudo guardar: ' + error.message); return }
    setEditandoId(null)
    cargar()
  }

  // --- Cambiar usuario de acceso / contraseña (solo dueña) ---
  const [accesoId, setAccesoId] = useState<string | null>(null)
  const [nuevoUsuario, setNuevoUsuario] = useState('')
  const [nuevaPassword, setNuevaPassword] = useState('')
  const [guardandoAcceso, setGuardandoAcceso] = useState(false)
  const [accesoError, setAccesoError] = useState<string | null>(null)
  const [accesoMensaje, setAccesoMensaje] = useState<string | null>(null)

  function abrirAcceso(p: Profile) {
    if (accesoId === p.id) { setAccesoId(null); return }
    setAccesoId(p.id)
    setNuevoUsuario('')
    setNuevaPassword('')
    setAccesoError(null)
    setAccesoMensaje(null)
  }

  async function actualizarAcceso(p: Profile) {
    setAccesoError(null)
    setAccesoMensaje(null)
    if (!nuevoUsuario.trim() && !nuevaPassword.trim()) {
      setAccesoError('Escribe un nuevo usuario/correo o una nueva contraseña.')
      return
    }
    if (nuevaPassword.trim() && nuevaPassword.trim().length < 6) {
      setAccesoError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    setGuardandoAcceso(true)
    const { error } = await supabase.rpc('admin_actualizar_acceso', {
      p_user_id: p.id,
      p_nuevo_usuario: nuevoUsuario.trim() || null,
      p_nueva_password: nuevaPassword.trim() || null
    })
    setGuardandoAcceso(false)
    if (error) {
      setAccesoError(
        error.message.toLowerCase().includes('duplicate') || error.message.toLowerCase().includes('unique')
          ? 'Ese usuario/correo ya está en uso por otra cuenta.'
          : 'No se pudo actualizar: ' + error.message
      )
      return
    }
    setAccesoMensaje(
      'Acceso actualizado.' +
        (nuevoUsuario.trim() ? ` Su usuario para entrar es exactamente: ${nuevoUsuario.trim()}.` : '') +
        ' Avísale a la persona su nuevo usuario/contraseña.'
    )
    setNuevoUsuario('')
    setNuevaPassword('')
  }

  // Borrar una cuenta de clienta -- personal se queda solo con "Sin acceso"
  // (ver nota en la migración: borrar staff perdería de vista quién hizo
  // qué en el historial ya registrado).
  async function borrarCliente(p: Profile) {
    if (!confirm(`¿Borrar la cuenta de ${p.nombre}? Esta acción no se puede deshacer.`)) return
    setAccionError(null); setAccionMensaje(null)
    const { error } = await supabase.rpc('admin_eliminar_cliente', { p_user_id: p.id })
    if (error) {
      setAccionError(
        error.message.toLowerCase().includes('foreign key') || error.message.toLowerCase().includes('violat')
          ? `No se puede borrar a ${p.nombre}: ya tiene citas o créditos registrados. Puedes quitarle el acceso en su lugar.`
          : 'No se pudo borrar: ' + error.message
      )
      return
    }
    setAccionMensaje(`Cuenta de ${p.nombre} eliminada.`)
    cargar()
  }

  const esPersonal = (r: Rol) => r === 'superadmin' || r === 'admin' || r === 'personal'
  const conteoPersonal = perfiles.filter((p) => esPersonal(p.rol)).length
  const conteoClientes = perfiles.filter((p) => p.rol === 'cliente').length

  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    return perfiles.filter((p) => {
      const enGrupo = pestana === 'personal' ? esPersonal(p.rol) : p.rol === 'cliente'
      if (!enGrupo) return false
      if (!f) return true
      return p.nombre.toLowerCase().includes(f) || p.rol.includes(f)
    })
  }, [perfiles, filtro, pestana])

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Usuarios</h1>
        <button
          onClick={() => { setMostrarAlta((v) => !v); setError(null); setMensaje(null) }}
          className="text-sm bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg px-3 py-1.5"
        >
          {mostrarAlta ? 'Cerrar' : '+ Crear usuario'}
        </button>
      </div>

      {accionError && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{accionError}</div>}
      {accionMensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{accionMensaje}</div>}

      {mostrarAlta && (
        <form onSubmit={crearUsuario} className="bg-white rounded-2xl shadow p-4 space-y-3">
          <h2 className="font-semibold text-sm text-gray-600">Crear usuario</h2>
          {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
          {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Nombre</label>
              <input required value={nNombre} onChange={(e) => setNNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Rol</label>
              <select value={nRol} onChange={(e) => setNRol(e.target.value as Rol)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                {ROLES.map((r) => (
                  <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Usuario o correo</label>
            <input
              required
              autoCapitalize="none"
              value={nUsuario}
              onChange={(e) => setNUsuario(e.target.value)}
              placeholder="ej: maria  (o maria@correo.com)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            <p className="text-xs text-gray-400 mt-1">
              Si escribes solo un usuario (sin @), entrará escribiendo ese nombre. Si es una clienta con correo real, ponlo completo.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Contraseña</label>
              <input type="text" required minLength={6} value={nPassword} onChange={(e) => setNPassword(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Teléfono (opcional)</label>
              <input value={nTelefono} onChange={(e) => setNTelefono(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
          </div>

          <button type="submit" disabled={creando} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
            {creando ? 'Creando…' : 'Crear usuario'}
          </button>
        </form>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800 space-y-1">
        <p>
          Puedes <strong>crear usuarios</strong> aquí, cambiarles el <strong>rol</strong> y sus
          <strong> especialidades</strong>, <strong>quitarles el acceso</strong> (botón verde/gris),
          editar su <strong>nombre y datos</strong>, o cambiarles el <strong>usuario/contraseña</strong>
          de acceso desde "Usuario / contraseña".
        </p>
        <p>
          Las especialidades son solo una etiqueta: <strong>a cualquier profesional se le puede asignar
          cualquier servicio</strong>, sin importar cómo esté etiquetada.
        </p>
      </div>

      <div className="flex gap-1 bg-white/70 rounded-xl p-1 shadow-sm">
        <button
          onClick={() => setPestana('personal')}
          className={`flex-1 text-xs sm:text-sm font-medium rounded-lg py-2 px-1 transition ${pestana === 'personal' ? 'bg-brand-600 text-white' : 'text-gray-500'}`}
        >
          <span className="hidden sm:inline">Personal de la empresa</span>
          <span className="sm:hidden">Personal</span> ({conteoPersonal})
        </button>
        <button
          onClick={() => setPestana('clientes')}
          className={`flex-1 text-xs sm:text-sm font-medium rounded-lg py-2 px-1 transition ${pestana === 'clientes' ? 'bg-brand-600 text-white' : 'text-gray-500'}`}
        >
          Clientes ({conteoClientes})
        </button>
      </div>

      <input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar por nombre o rol…"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />

      <div className="space-y-3">
        {visibles.map((p) => (
          <div key={p.id} className={`bg-white rounded-2xl shadow p-3 space-y-3 ${p.activo ? '' : 'opacity-60'}`}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {p.nombre}
                  {p.id === profile?.id && <span className="text-brand-500 text-xs ml-1">(tú)</span>}
                </p>
                {p.telefono && <p className="text-gray-400 text-xs">{p.telefono}</p>}
              </div>
              <select
                value={p.rol}
                onChange={(e) => cambiarRol(p.id, e.target.value as Rol)}
                disabled={p.id === profile?.id}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:opacity-50"
              >
                {ROLES.map((r) => (
                  <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
                ))}
              </select>
              <button
                onClick={() => alternarActivo(p)}
                disabled={p.id === profile?.id}
                title={p.activo ? 'Quitar acceso' : 'Reactivar'}
                className={`text-xs px-2 py-1 rounded-full disabled:opacity-50 ${p.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
              >
                {p.activo ? 'Con acceso' : 'Sin acceso'}
              </button>
            </div>

            {p.rol === 'personal' && (
              <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-50">
                <span className="text-xs text-gray-400 self-center">Especialidades:</span>
                {ESPECIALIDADES.map((e) => {
                  const activa = (p.especialidades ?? []).includes(e.valor)
                  return (
                    <button
                      key={e.valor}
                      onClick={() => alternarEspecialidad(p, e.valor)}
                      className={`text-xs px-2 py-1 rounded-full border ${activa ? 'bg-brand-100 border-brand-300 text-brand-700' : 'bg-white border-gray-200 text-gray-400'}`}
                    >
                      {activa ? '✓ ' : ''}{e.etiqueta}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="pt-1 border-t border-gray-50 space-y-2">
              <div className="flex flex-wrap gap-3">
                <button onClick={() => abrirDatos(p)} className="text-xs text-brand-600 font-medium">
                  {editandoId === p.id ? 'Cerrar datos ▲' : 'Datos básicos ▾'}
                </button>
                <button onClick={() => abrirAcceso(p)} className="text-xs text-brand-600 font-medium">
                  {accesoId === p.id ? 'Cerrar acceso ▲' : 'Usuario / contraseña ▾'}
                </button>
                {p.rol === 'cliente' && (
                  <button onClick={() => borrarCliente(p)} className="text-xs text-red-500 font-medium">
                    Borrar cuenta
                  </button>
                )}
              </div>

              {editandoId === p.id && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {datosError && <div className="sm:col-span-2 text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{datosError}</div>}
                  <input placeholder="Nombre" value={datos.nombre ?? ''} onChange={(e) => setDatos((d) => ({ ...d, nombre: e.target.value }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm sm:col-span-2" />
                  <input placeholder="Apellidos" value={datos.apellidos ?? ''} onChange={(e) => setDatos((d) => ({ ...d, apellidos: e.target.value }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  <input placeholder="Cédula" value={datos.cedula ?? ''} onChange={(e) => setDatos((d) => ({ ...d, cedula: e.target.value }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  <input placeholder="Teléfono" value={datos.telefono ?? ''} onChange={(e) => setDatos((d) => ({ ...d, telefono: e.target.value }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  <input placeholder="Correo" value={datos.correo ?? ''} onChange={(e) => setDatos((d) => ({ ...d, correo: e.target.value }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  <input placeholder="Dirección" value={datos.direccion ?? ''} onChange={(e) => setDatos((d) => ({ ...d, direccion: e.target.value }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm sm:col-span-2" />
                  <label className="text-xs text-gray-500">Nacimiento
                    <input type="date" value={datos.fecha_nacimiento ?? ''} onChange={(e) => setDatos((d) => ({ ...d, fecha_nacimiento: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  </label>
                  <label className="text-xs text-gray-500">Ingreso al spa
                    <input type="date" value={datos.fecha_ingreso ?? ''} onChange={(e) => setDatos((d) => ({ ...d, fecha_ingreso: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  </label>
                  <button onClick={() => guardarDatos(p.id)} className="sm:col-span-2 bg-brand-600 text-white text-sm rounded-lg py-1.5 font-medium">Guardar datos</button>
                </div>
              )}

              {accesoId === p.id && (
                <div className="space-y-2">
                  {accesoError && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{accesoError}</div>}
                  {accesoMensaje && <div className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{accesoMensaje}</div>}
                  <input
                    autoCapitalize="none"
                    placeholder="Nuevo usuario o correo (dejar vacío para no cambiar)"
                    value={nuevoUsuario}
                    onChange={(e) => setNuevoUsuario(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="text"
                    minLength={6}
                    placeholder="Nueva contraseña (dejar vacío para no cambiar)"
                    value={nuevaPassword}
                    onChange={(e) => setNuevaPassword(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => actualizarAcceso(p)}
                    disabled={guardandoAcceso}
                    className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-1.5"
                  >
                    {guardandoAcceso ? 'Actualizando…' : 'Actualizar acceso'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {visibles.length === 0 && <p className="text-sm text-gray-400 p-3">No hay usuarios que coincidan.</p>}
      </div>
    </div>
  )
}
