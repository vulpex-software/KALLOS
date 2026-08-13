import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { fechaHoy } from '../lib/fechas'
import { logoParaSalon, nombreParaSalon, esloganParaSalon } from '../lib/branding'
import type { Cita, Profile } from '../types'

interface GrupoLinks {
  titulo: string | null
  items: { to: string; label: string }[]
}

// Agrupado por sección para el sidebar (antes era una sola fila arriba).
const gruposPorRol: Record<string, GrupoLinks[]> = {
  personal: [
    { titulo: null, items: [
      { to: '/jornada', label: 'Mi jornada' },
      { to: '/registro', label: 'Registrar trabajo' },
      { to: '/mi-comision', label: 'Mi comisión' },
      { to: '/permisos', label: 'Permisos' },
      { to: '/mi-perfil', label: 'Mi perfil' }
    ] }
  ],
  admin: [
    { titulo: 'operación', items: [
      { to: '/cobros', label: 'Cobros' },
      { to: '/cierre-caja', label: 'Cierre de caja' },
      { to: '/citas', label: 'Citas' },
      { to: '/ventas', label: 'Ventas' },
      { to: '/reportes', label: 'Reportes' }
    ] },
    { titulo: 'personal', items: [
      { to: '/jornada', label: 'Mi jornada' },
      { to: '/permisos', label: 'Permisos' },
      { to: '/asistencia', label: 'Asistencia' }
    ] }
  ],
  superadmin: [
    { titulo: 'general', items: [
      { to: '/dashboard', label: 'Panel' },
      { to: '/cobros', label: 'Cobros' },
      { to: '/citas', label: 'Citas' },
      { to: '/ventas', label: 'Ventas' }
    ] },
    { titulo: 'operación', items: [
      { to: '/cierre-caja', label: 'Cierre de caja' },
      { to: '/asistencia', label: 'Asistencia' },
      { to: '/permisos', label: 'Permisos' },
      { to: '/productos', label: 'Inventario' },
      { to: '/contabilidad', label: 'Contabilidad' },
      { to: '/prestamos', label: 'Préstamos' }
    ] },
    { titulo: 'administración', items: [
      { to: '/historial', label: 'Historial' },
      { to: '/auditoria', label: 'Auditoría' },
      { to: '/usuarios', label: 'Usuarios' },
      { to: '/servicios', label: 'Servicios' }
    ] }
  ]
}

// Citas que necesitan atención: solicitudes pendientes o ya confirmadas que
// se reprogramaron. Se avisa sin importar la fecha ni la página en la que
// esté la administradora (se agenden internamente o las pida la clienta).
async function consultarCitasPendientes(): Promise<Cita[]> {
  const { data } = await supabase
    .from('citas')
    .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
    .or('estado.eq.pendiente,reprogramada.eq.true')
    .order('fecha')
    .order('hora')
  return (data as Cita[]) ?? []
}

function useCitasPendientes(activo: boolean) {
  const [citas, setCitas] = useState<Cita[]>([])
  const location = useLocation()

  async function recargar() {
    setCitas(await consultarCitasPendientes())
  }

  useEffect(() => {
    if (!activo) return
    let cancelado = false
    async function tick() {
      const datos = await consultarCitasPendientes()
      if (!cancelado) setCitas(datos)
    }
    tick()
    const intervalo = setInterval(tick, 30000)
    return () => {
      cancelado = true
      clearInterval(intervalo)
    }
    // Se refresca también al cambiar de página (p. ej. tras confirmar una cita).
  }, [activo, location.pathname])

  return { citas, recargar }
}

// Campanita de la profesional: sus propias citas asignadas para hoy.
// Es solo informativa (ella no confirma ni reprograma), un respaldo del
// aviso push por si no dio el permiso o el celular no lo mostró.
async function consultarMisCitasHoy(empleadaId: string): Promise<Cita[]> {
  const { data } = await supabase
    .from('citas')
    .select('*')
    .eq('empleada_id', empleadaId)
    .eq('fecha', fechaHoy())
    .in('estado', ['pendiente', 'confirmada'])
    .order('hora')
  return (data as Cita[]) ?? []
}

function useMisCitasHoy(empleadaId: string | undefined) {
  const [citas, setCitas] = useState<Cita[]>([])
  const location = useLocation()

  useEffect(() => {
    if (!empleadaId) return
    const id = empleadaId
    let cancelado = false
    async function tick() {
      const datos = await consultarMisCitasHoy(id)
      if (!cancelado) setCitas(datos)
    }
    tick()
    const intervalo = setInterval(tick, 30000)
    return () => {
      cancelado = true
      clearInterval(intervalo)
    }
  }, [empleadaId, location.pathname])

  return citas
}

function formatearFechaCorta(fecha: string) {
  const [, mes, dia] = fecha.split('-')
  return `${dia}/${mes}`
}

// Cumpleaños del personal que caen MAÑANA (mismo criterio de aviso
// anticipado que el resto de la app usa para citas). Solo compara mes/día
// -- el año de fecha_nacimiento no importa para esto.
async function consultarCumpleañosMañana(): Promise<Profile[]> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .in('rol', ['personal', 'admin', 'superadmin'])
    .eq('activo', true)
    .not('fecha_nacimiento', 'is', null)
  const perfiles = (data as Profile[]) ?? []
  const mañana = new Date()
  mañana.setDate(mañana.getDate() + 1)
  const mes = mañana.getMonth() + 1
  const dia = mañana.getDate()
  return perfiles.filter((p) => {
    if (!p.fecha_nacimiento) return false
    const [, mesStr, diaStr] = p.fecha_nacimiento.split('-')
    return Number(mesStr) === mes && Number(diaStr) === dia
  })
}

function useCumpleañosMañana(activo: boolean) {
  const [cumpleañeros, setCumpleañeros] = useState<Profile[]>([])

  useEffect(() => {
    if (!activo) return
    let cancelado = false
    consultarCumpleañosMañana().then((datos) => {
      if (!cancelado) setCumpleañeros(datos)
    })
    return () => {
      cancelado = true
    }
    // No hace falta refrescar por intervalo: la fecha de nacimiento del
    // personal no cambia durante el día.
  }, [activo])

  return cumpleañeros
}

interface CampanitaProps {
  citasPendientes: Cita[]
  cumpleañosMañana: Profile[]
  onAbrirCita: (c: Cita) => void
  onMarcarVisto: (c: Cita) => void
}

// Componente ESTABLE a nivel de módulo (no se define dentro de Layout):
// si se recreara en cada render, React desmontaría y volvería a montar todo
// el desplegable en cada actualización (p. ej. cada 30s al refrescar la
// campanita), lo que puede perder el clic de un botón a medio camino.
// Además cada instancia usa su PROPIA ref: como hay una copia para el menú
// de escritorio y otra para el de móvil (una queda oculta por CSS según el
// tamaño de pantalla, pero ambas existen en el DOM), si compartieran una
// sola ref el detector de "clic afuera" podía cerrar el panel por error al
// tocar dentro de la copia que la ref no apuntaba, cancelando el clic real.
function Campanita({ citasPendientes, cumpleañosMañana, onAbrirCita, onMarcarVisto }: CampanitaProps) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const totalAvisos = citasPendientes.length + cumpleañosMañana.length

  useEffect(() => {
    if (!abierto) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [abierto])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAbierto((v) => !v)}
        className="relative p-2 text-brand-300"
        aria-label="Notificaciones de citas"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {totalAvisos > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {totalAvisos > 9 ? '9+' : totalAvisos}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 mt-1 w-80 max-w-[90vw] bg-white rounded-2xl shadow-xl border border-gray-100 z-50 max-h-[70vh] overflow-y-auto">
          <div className="p-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">🔔 Solicitudes y cambios por revisar</h3>
          </div>
          {cumpleañosMañana.length > 0 && (
            <div className="p-3 bg-brand-50 border-b border-gray-100">
              <p className="text-xs font-semibold text-brand-700 mb-1">🎂 Cumpleaños mañana</p>
              <p className="text-sm text-brand-800">{cumpleañosMañana.map((p) => p.nombre).join(', ')}</p>
            </div>
          )}
          {citasPendientes.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">No hay citas pendientes por revisar.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {citasPendientes.map((c) => (
                <li key={c.id} className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      <span className="text-brand-600">{formatearFechaCorta(c.fecha)}</span> · {c.hora.slice(0, 5)} · {c.servicio?.nombre ?? 'Servicio'}
                    </p>
                    {c.reprogramada ? (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">Reprogramada</span>
                    ) : (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Pendiente</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{c.cliente_nombre}{c.empleada?.nombre ? ` · ${c.empleada.nombre}` : ''}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() => { setAbierto(false); onAbrirCita(c) }}
                      className="text-xs text-blue-700 underline font-medium"
                    >
                      {c.estado === 'pendiente' ? 'Confirmar' : 'Abrir'}
                    </button>
                    {c.reprogramada && (
                      <button
                        type="button"
                        onClick={() => onMarcarVisto(c)}
                        className="text-xs text-purple-700 underline"
                      >
                        Marcar como visto
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function CampanitaPersonal({ citas, onIrARegistro }: { citas: Cita[]; onIrARegistro: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [abierto])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAbierto((v) => !v)}
        className="relative p-2 text-brand-300"
        aria-label="Tus citas de hoy"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {citas.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {citas.length > 9 ? '9+' : citas.length}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 mt-1 w-80 max-w-[90vw] bg-white rounded-2xl shadow-xl border border-gray-100 z-50 max-h-[70vh] overflow-y-auto">
          <div className="p-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">🔔 Tus citas de hoy</h3>
          </div>
          {citas.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">No tienes citas asignadas hoy.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {citas.map((c) => (
                <li key={c.id} className="p-3 space-y-1">
                  <p className="text-sm font-medium">
                    <span className="text-brand-600">{c.hora.slice(0, 5)}</span> · {c.cliente_nombre}
                  </p>
                  {c.obsequios.length > 0 && (
                    <p className="text-xs text-brand-700 bg-brand-50 rounded px-2 py-0.5">🎁 {c.obsequios.length > 1 ? 'Obsequios' : 'Obsequio'}: {c.obsequios.join(', ')}</p>
                  )}
                  {c.nota_interna && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-0.5">📌 {c.nota_interna}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="p-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => { setAbierto(false); onIrARegistro() }}
              className="w-full text-xs text-blue-700 underline font-medium text-center py-1"
            >
              Ir a Registrar trabajo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { profile, salon, esOperador, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuAbierto, setMenuAbierto] = useState(false)
  usePushNotifications()
  // El operador de plataforma solo ve su consola: las demás pantallas son
  // del negocio de UN salón y su salón ("KALLOS Plataforma") está vacío.
  const grupos: GrupoLinks[] = esOperador
    ? [{ titulo: null, items: [{ to: '/plataforma', label: 'Consola KALLOS' }] }]
    : profile ? gruposPorRol[profile.rol] ?? [] : []
  const puedeVerCitas = profile?.rol === 'admin' || profile?.rol === 'superadmin'
  const esPersonal = profile?.rol === 'personal'
  const { citas: citasPendientes, recargar } = useCitasPendientes(puedeVerCitas)
  const cumpleañosMañana = useCumpleañosMañana(puedeVerCitas)
  const misCitasHoy = useMisCitasHoy(esPersonal ? profile?.id : undefined)
  // Manual de uso: la dueña ve todo el manual, los demás roles ven solo su sección.
  const manualHref = `/manual.html?rol=${profile?.rol ?? ''}`

  async function marcarVisto(c: Cita) {
    await supabase.from('citas').update({ reprogramada: false }).eq('id', c.id)
    recargar()
  }

  function abrirEnCitas(c: Cita) {
    setMenuAbierto(false)
    navigate('/citas', { state: { citaParaAbrir: c } })
  }

  function irARegistro() {
    setMenuAbierto(false)
    navigate('/registro')
  }

  // Estilo compartido del sidebar (escritorio) y el panel deslizable (móvil):
  // activo = franja de acento a la izquierda + fondo tenue del acento;
  // inactivo = texto del panel atenuado, sin fondo hasta el hover.
  const claseLinkSidebar = ({ isActive }: { isActive: boolean }) =>
    `block text-sm px-3 py-2 rounded-r-lg border-l-2 ${
      isActive
        ? 'bg-accent2/15 border-accent2 text-panel-fg font-medium'
        : 'border-transparent text-panel-fg/70 hover:bg-white/5 hover:text-panel-fg'
    }`

  // Si un operador de plataforma entró "como" este salón (soporte), lo
  // marca esta bandera (ver Plataforma.tsx). Salir cierra sesión de
  // verdad: el operador vuelve a loguearse con su propia clave a propósito
  // (más simple y más seguro que tratar de restaurar su sesión sola).
  const impersonando = sessionStorage.getItem('kallos_impersonando')

  async function salirDeImpersonar() {
    sessionStorage.removeItem('kallos_impersonando')
    await signOut()
    navigate('/login', { replace: true })
  }

  const iconoAyuda = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 1.9-2.4 3.7" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )

  // Nav agrupada, compartida entre el sidebar de escritorio y el panel
  // deslizable de móvil (mismo contenido, mismo estilo).
  function navAgrupada(alClick?: () => void) {
    return (
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {grupos.map((g, i) => (
          <div key={g.titulo ?? i}>
            {g.titulo && (
              <p className="px-3 pb-1 text-[11px] uppercase tracking-[0.08em] text-panel-fg/45">{g.titulo}</p>
            )}
            <div className="space-y-0.5">
              {g.items.map((l) => (
                <NavLink key={l.to} to={l.to} onClick={alClick} className={claseLinkSidebar}>{l.label}</NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    )
  }

  return (
    <div className="min-h-screen">
      {impersonando && (
        <div className="bg-amber-500 text-ink text-sm font-medium px-4 py-2 flex items-center justify-between gap-2 sticky top-0 z-30">
          <span>🔧 Viendo como {impersonando} (modo soporte)</span>
          <button onClick={salirDeImpersonar} className="underline font-semibold">Salir</button>
        </div>
      )}

      <div className="md:flex md:items-start">
        {/* Barra superior: solo en móvil (en escritorio la identidad vive arriba del sidebar) */}
        <header className="md:hidden bg-ink/95 backdrop-blur border-b border-brand-900 sticky top-0 z-20">
          <div className="px-4 py-3 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2.5 min-w-0">
              <img src={logoParaSalon(salon)} alt={nombreParaSalon(salon)} className="w-9 h-9 object-contain shrink-0" />
              <span className="min-w-0 leading-tight">
                <span className="block font-serif font-semibold text-brand-300 tracking-[0.2em] truncate">{nombreParaSalon(salon)}</span>
                <span className="block text-[9px] uppercase tracking-[0.14em] text-brand-500 truncate">{esloganParaSalon(salon)}</span>
              </span>
            </span>

            <div className="flex items-center gap-1">
              <a href={manualHref} target="_blank" rel="noopener noreferrer" className="p-2 text-brand-300" aria-label="Ayuda: manual de uso">{iconoAyuda}</a>
              {puedeVerCitas && (
                <Campanita citasPendientes={citasPendientes} cumpleañosMañana={cumpleañosMañana} onAbrirCita={abrirEnCitas} onMarcarVisto={marcarVisto} />
              )}
              {esPersonal && (
                <CampanitaPersonal citas={misCitasHoy} onIrARegistro={irARegistro} />
              )}
              <button onClick={() => setMenuAbierto((v) => !v)} className="p-2 -mr-2 text-brand-300" aria-label="Menú">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        {/* Panel deslizable de móvil (reemplaza el desplegable de abajo del header) */}
        {menuAbierto && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMenuAbierto(false)} />
            <aside className="relative w-72 max-w-[80vw] h-full bg-panel text-panel-fg flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <span className="font-serif font-semibold text-panel-fg tracking-[0.14em] truncate">{nombreParaSalon(salon)}</span>
                <button onClick={() => setMenuAbierto(false)} className="p-1 text-panel-fg/70" aria-label="Cerrar menú">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              {navAgrupada(() => setMenuAbierto(false))}
              <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
                <span className="text-sm text-panel-fg/70 truncate">
                  {profile?.nombre}{salon?.nombre ? ` · ${salon.nombre}` : ''}
                </span>
                <button onClick={signOut} className="text-sm font-medium text-red-400">Salir</button>
              </div>
            </aside>
          </div>
        )}

        {/* Sidebar fijo de escritorio */}
        <aside className="hidden md:flex md:flex-col md:w-64 md:shrink-0 md:h-screen md:sticky md:top-0 bg-panel text-panel-fg">
          <div className="px-4 py-4 border-b border-white/10">
            <img src={logoParaSalon(salon)} alt={nombreParaSalon(salon)} className="w-10 h-10 object-contain mb-2" />
            <p className="font-serif font-semibold text-panel-fg tracking-[0.18em] truncate">{nombreParaSalon(salon)}</p>
            <p className="text-[9px] uppercase tracking-[0.12em] text-panel-fg/50 truncate">{esloganParaSalon(salon)}</p>
          </div>

          {navAgrupada()}

          <div className="px-3 py-2 border-t border-white/10 flex items-center gap-1">
            <a href={manualHref} target="_blank" rel="noopener noreferrer" className="p-2 text-panel-fg/70 hover:text-panel-fg" aria-label="Ayuda: manual de uso">{iconoAyuda}</a>
            {puedeVerCitas && (
              <Campanita citasPendientes={citasPendientes} cumpleañosMañana={cumpleañosMañana} onAbrirCita={abrirEnCitas} onMarcarVisto={marcarVisto} />
            )}
            {esPersonal && (
              <CampanitaPersonal citas={misCitasHoy} onIrARegistro={irARegistro} />
            )}
          </div>
          <div className="px-4 py-3 border-t border-white/10">
            <p className="text-sm text-panel-fg truncate">{profile?.nombre}</p>
            {salon?.nombre && <p className="text-[11px] text-panel-fg/50 truncate">{salon.nombre}</p>}
            <button onClick={signOut} className="mt-1 text-xs text-panel-fg/60 hover:text-red-400">Salir</button>
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <main className="flex-1">
            <Outlet />
          </main>

          <footer className="text-center text-[11px] text-gray-300 py-4">
            Developed by Vulpex Software SAS
          </footer>
        </div>
      </div>
    </div>
  )
}
