import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { CATEGORIAS_SERVICIOS } from '../lib/categoriasServicios'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { useAuth } from '../contexts/AuthContext'
import type { Obsequio, Servicio } from '../types'

// Valor centinela del <option> "Nueva categoría…". No puede chocar con una
// categoría real porque ninguna se llama así.
const NUEVA_CATEGORIA = '__nueva__'

export default function Servicios() {
  const { profile } = useAuth()
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [precios, setPrecios] = useState<Record<string, string>>({})
  const [guardandoId, setGuardandoId] = useState<string | null>(null)

  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState<string>(CATEGORIAS_SERVICIOS[0])
  // Última opción del selector: deja escribir una categoría que no está en
  // la lista. La columna servicios.categoria es texto libre, así que no hace
  // falta nada en la base de datos -- la categoría "existe" desde que hay un
  // servicio guardado con ese nombre.
  const [categoriaNueva, setCategoriaNueva] = useState('')
  const esNuevaCategoria = categoria === NUEVA_CATEGORIA
  const [precioNuevo, setPrecioNuevo] = useState('')
  // Un combo suma el precio y la duración de los servicios que elijas del
  // catálogo -- no se desglosa después, queda como un servicio normal más.
  const esCombo = (esNuevaCategoria ? categoriaNueva.trim() : categoria) === 'Combo'
  const [comboServiciosIds, setComboServiciosIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const [obsequios, setObsequios] = useState<Obsequio[]>([])
  const [nombreObsequio, setNombreObsequio] = useState('')
  const [errorObsequio, setErrorObsequio] = useState<string | null>(null)

  async function cargar() {
    const { data } = await supabase
      .from('servicios')
      .select('*')
      .order('categoria')
      .order('nombre')
    const lista = (data as Servicio[]) ?? []
    setServicios(lista)
    setPrecios(Object.fromEntries(lista.map((s) => [s.id, String(s.precio_base)])))
  }

  async function cargarObsequios() {
    const { data } = await supabase.from('obsequios').select('*').order('nombre')
    setObsequios((data as Obsequio[]) ?? [])
  }

  useEffect(() => {
    cargar()
    cargarObsequios()
  }, [])

  async function crearObsequio(e: FormEvent) {
    e.preventDefault()
    setErrorObsequio(null)
    if (!profile) return
    const { error } = await supabase.from('obsequios').insert({ salon_id: profile.salon_id, nombre: nombreObsequio.trim(), creado_por: profile.id })
    if (error) {
      setErrorObsequio(
        error.message.toLowerCase().includes('duplicate') ? 'Ya existe un obsequio con ese nombre.' : 'No se pudo agregar: ' + error.message
      )
    } else {
      setNombreObsequio('')
      cargarObsequios()
    }
  }

  async function alternarObsequio(o: Obsequio) {
    await supabase.from('obsequios').update({ activo: !o.activo }).eq('id', o.id)
    cargarObsequios()
  }

  // Servicios elegibles para armar un combo: activos, sin contar los
  // adicionales (monto libre, no tiene sentido sumarlo a un precio fijo) ni
  // otros combos (evita anidar combos dentro de combos).
  const serviciosParaCombo = useMemo(
    () => servicios.filter((s) => s.activo && s.categoria !== 'Adicional' && s.categoria !== 'Combo'),
    [servicios]
  )

  const comboTotales = useMemo(() => {
    const elegidos = servicios.filter((s) => comboServiciosIds.includes(s.id))
    return {
      precio: elegidos.reduce((sum, s) => sum + Number(s.precio_base), 0),
      duracion: elegidos.reduce((sum, s) => sum + Number(s.duracion_minutos), 0)
    }
  }, [servicios, comboServiciosIds])

  function alternarServicioCombo(id: string) {
    setComboServiciosIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // Las de siempre, más las que este salón haya creado por su cuenta (se
  // descubren de los servicios ya guardados, incluidos los inactivos, para
  // que una categoría no desaparezca del selector al desactivar su último
  // servicio).
  const categoriasDisponibles = useMemo(() => {
    const fijas = [...CATEGORIAS_SERVICIOS] as string[]
    const propias = [...new Set(servicios.map((s) => s.categoria))]
      .filter((c) => !fijas.includes(c))
      .sort((a, b) => a.localeCompare(b, 'es'))
    return [...fijas, ...propias]
  }, [servicios])

  const porCategoria = useMemo(() => {
    const mapa = new Map<string, Servicio[]>()
    for (const s of servicios) {
      const lista = mapa.get(s.categoria) ?? []
      lista.push(s)
      mapa.set(s.categoria, lista)
    }
    return [...mapa.entries()]
  }, [servicios])

  async function guardarPrecio(id: string) {
    const valor = Number(precios[id])
    if (Number.isNaN(valor) || valor < 0) return
    setGuardandoId(id)
    await supabase.from('servicios').update({ precio_base: valor }).eq('id', id)
    setGuardandoId(null)
    cargar()
  }

  // Renombrar un servicio: se corrige una falta de ortografía o cambia cómo
  // lo llaman en el salón, sin tener que crear uno nuevo y desactivar el
  // viejo (que partiría el historial en dos). RLS ya lo permitía
  // ("solo gestor administra servicios de su salon", for all), pero acá se
  // deja solo para la dueña. El precio y el historial no se tocan.
  const [renombrandoId, setRenombrandoId] = useState<string | null>(null)
  const [nombreEditado, setNombreEditado] = useState('')
  const [errorRenombrar, setErrorRenombrar] = useState<string | null>(null)

  async function guardarNombre(s: Servicio) {
    const limpio = nombreEditado.trim()
    setErrorRenombrar(null)
    if (!limpio) {
      setErrorRenombrar('El nombre no puede quedar vacío.')
      return
    }
    if (limpio === s.nombre) {
      setRenombrandoId(null)
      return
    }
    const { error } = await supabase.from('servicios').update({ nombre: limpio }).eq('id', s.id)
    if (error) {
      setErrorRenombrar(
        error.message.toLowerCase().includes('duplicate')
          ? `Ya hay un servicio llamado "${limpio}" en ${s.categoria}.`
          : 'No se pudo cambiar el nombre: ' + error.message
      )
      return
    }
    setRenombrandoId(null)
    cargar()
  }

  async function alternarActivo(s: Servicio) {
    await supabase.from('servicios').update({ activo: !s.activo }).eq('id', s.id)
    cargar()
  }

  async function crearServicio(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMensaje(null)
    if (!profile) return
    if (esCombo && comboServiciosIds.length < 2) {
      setError('Elige al menos 2 servicios para armar el combo.')
      return
    }
    let categoriaFinal = categoria
    if (esNuevaCategoria) {
      const escrita = categoriaNueva.trim()
      if (!escrita) {
        setError('Escribe el nombre de la categoría nueva.')
        return
      }
      // Si ya existe escrita distinto (ej. "manicure" contra "Manicure"), se
      // usa la que ya está para no partir el catálogo en dos grupos iguales.
      categoriaFinal = categoriasDisponibles.find((c) => c.toLowerCase() === escrita.toLowerCase()) ?? escrita
    }
    const { error } = await supabase.from('servicios').insert({
      salon_id: profile.salon_id,
      categoria: categoriaFinal,
      nombre,
      precio_base: esCombo ? comboTotales.precio : Number(precioNuevo || 0),
      ...(esCombo ? { duracion_minutos: comboTotales.duracion } : {})
    })
    if (error) {
      setError('No se pudo crear el servicio. Revisa que no exista ya uno con el mismo nombre en esa categoría.')
    } else {
      setMensaje(esCombo ? 'Combo agregado.' : 'Servicio agregado.')
      setNombre('')
      setPrecioNuevo('')
      setComboServiciosIds([])
      await cargar()
      // Deja la categoría recién creada seleccionada, para poder cargarle
      // varios servicios seguidos sin volver a escribirla.
      setCategoria(categoriaFinal)
      setCategoriaNueva('')
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Servicios y precios</h1>
      <p className="text-sm text-gray-500 -mt-4">
        Aquí puedes actualizar los precios cuando quieras, sin depender de nadie más. Los cambios
        aplican solo a los trabajos que se registren de ahora en adelante.
      </p>

      <form onSubmit={crearServicio} className="bg-white rounded-2xl shadow p-4 space-y-3">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}
        <h2 className="font-semibold text-sm text-gray-600">Agregar nuevo servicio</h2>
        <div className={`grid grid-cols-1 ${esCombo ? '' : 'sm:grid-cols-2'} gap-3`}>
          <div>
            <label className="block text-sm font-medium mb-1">Categoría</label>
            <select
              value={categoria}
              onChange={(e) => { setCategoria(e.target.value); setComboServiciosIds([]) }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              {categoriasDisponibles.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={NUEVA_CATEGORIA}>+ Nueva categoría…</option>
            </select>
            {esNuevaCategoria && (
              <>
                <input
                  autoFocus
                  value={categoriaNueva}
                  onChange={(e) => setCategoriaNueva(e.target.value)}
                  placeholder="Nombre de la categoría nueva"
                  maxLength={40}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 mt-2"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Queda creada al guardar el primer servicio, y aparece en la lista de arriba de ahí en adelante.
                </p>
              </>
            )}
          </div>
          {!esCombo && (
            <div>
              <label className="block text-sm font-medium mb-1">Precio</label>
              <input
                type="text" inputMode="numeric"
                value={formatearPesosInput(precioNuevo)}
                onChange={(e) => setPrecioNuevo(soloDigitos(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
          )}
        </div>

        {esCombo && (
          <div>
            <label className="block text-sm font-medium mb-1">Servicios que incluye el combo</label>
            {serviciosParaCombo.length === 0 ? (
              <p className="text-xs text-gray-400">No hay servicios activos para combinar todavía.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {serviciosParaCombo.map((s) => {
                  const activo = comboServiciosIds.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => alternarServicioCombo(s.id)}
                      className={`text-xs px-2 py-1 rounded-full border ${activo ? 'bg-brand-100 border-brand-300 text-brand-700' : 'bg-white border-gray-200 text-gray-400'}`}
                    >
                      {activo ? '✓ ' : ''}{s.nombre} (${Number(s.precio_base).toLocaleString('es-CO')})
                    </button>
                  )
                })}
              </div>
            )}
            {comboServiciosIds.length > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                Precio del combo: <b>${comboTotales.precio.toLocaleString('es-CO')}</b> · Duración: <b>{comboTotales.duracion} min</b>
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Nombre del {esCombo ? 'combo' : 'servicio'}</label>
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>
        <button type="submit" className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg py-2 transition">
          Agregar {esCombo ? 'combo' : 'servicio'}
        </button>
      </form>

      {porCategoria.map(([cat, lista]) => (
        <div key={cat} className="bg-white rounded-2xl shadow p-4">
          <h2 className="font-semibold text-sm text-brand-700 mb-3">{cat}</h2>
          <ul className="divide-y divide-gray-100">
            {lista.map((s) => (
              <li key={s.id} className="py-2 flex items-center gap-3 flex-wrap">
                {renombrandoId === s.id ? (
                  <input
                    autoFocus
                    value={nombreEditado}
                    onChange={(e) => setNombreEditado(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') guardarNombre(s)
                      if (e.key === 'Escape') { setRenombrandoId(null); setErrorRenombrar(null) }
                    }}
                    className="flex-1 min-w-[8rem] rounded-lg border border-brand-300 px-2 py-1 text-sm"
                  />
                ) : (
                  <span className={`flex-1 text-sm ${s.activo ? '' : 'text-gray-400 line-through'}`}>{s.nombre}</span>
                )}
                {profile?.rol === 'superadmin' && (
                  renombrandoId === s.id ? (
                    <>
                      <button onClick={() => guardarNombre(s)} className="text-xs px-2 py-1 rounded-lg bg-brand-600 text-white">
                        Guardar nombre
                      </button>
                      <button
                        onClick={() => { setRenombrandoId(null); setErrorRenombrar(null) }}
                        className="text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-500"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => { setRenombrandoId(s.id); setNombreEditado(s.nombre); setErrorRenombrar(null) }}
                      title="Cambiar el nombre"
                      className="text-xs px-2 py-1 rounded-lg text-gray-400 hover:text-brand-700"
                    >
                      ✏️
                    </button>
                  )
                )}
                {renombrandoId === s.id && errorRenombrar && (
                  <p className="w-full text-xs text-red-600">{errorRenombrar}</p>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-400">$</span>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(precios[s.id] ?? '')}
                    onChange={(e) => setPrecios((p) => ({ ...p, [s.id]: soloDigitos(e.target.value) }))}
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>
                <button
                  onClick={() => guardarPrecio(s.id)}
                  disabled={guardandoId === s.id || precios[s.id] === String(s.precio_base)}
                  className="text-xs px-2 py-1 rounded-lg bg-brand-100 text-brand-700 disabled:opacity-40"
                >
                  Guardar
                </button>
                <button
                  onClick={() => alternarActivo(s)}
                  className={`text-xs px-2 py-1 rounded-full ${s.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                >
                  {s.activo ? 'Activo' : 'Inactivo'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="bg-white rounded-2xl shadow p-4 space-y-3">
        <h2 className="font-semibold text-sm text-gray-600">Obsequios</h2>
        <p className="text-xs text-gray-400 -mt-2">
          Las cortesías que se pueden ofrecer al agendar o confirmar una cita. Agrega las que quieras
          aparte de las que ya vienen predeterminadas.
        </p>
        {errorObsequio && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{errorObsequio}</div>}
        <form onSubmit={crearObsequio} className="flex gap-2">
          <input
            required
            value={nombreObsequio}
            onChange={(e) => setNombreObsequio(e.target.value)}
            placeholder="Ej: Baño de burbujas"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="px-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
            Agregar
          </button>
        </form>
        <ul className="flex flex-wrap gap-2">
          {obsequios.map((o) => (
            <li key={o.id}>
              <button
                onClick={() => alternarObsequio(o)}
                className={`text-xs px-2 py-1 rounded-full ${o.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-400 line-through'}`}
              >
                {o.nombre}
              </button>
            </li>
          ))}
          {obsequios.length === 0 && <li className="text-sm text-gray-400">Aún no hay obsequios.</li>}
        </ul>
      </div>
    </div>
  )
}
