import type { Salon } from '../types'

// Paleta de la plataforma (negro + dorado) definida como variables CSS en
// src/index.css (:root). Si un salón tiene color_primario/color_secundario,
// los pisamos acá en runtime -- así "cada salón con su propia suite" no
// requiere tocar código, solo esas columnas en la tabla salones. Si no
// tiene, se queda con el default de la plataforma (no hacemos nada, dejamos
// que el CSS mande).
const VARIABLES_A_PISAR = [
  '--brand-500', '--brand-600', '--brand-700',
  '--panel', '--panel-fg', '--accent2', '--page-tint', '--page-mesh', '--page-mesh-alpha'
] as const

function hexARgbTriple(hex: string): string | null {
  const limpio = hex.trim().replace('#', '')
  const valida = /^[0-9a-fA-F]{6}$/.test(limpio)
  if (!valida) return null
  const r = parseInt(limpio.slice(0, 2), 16)
  const g = parseInt(limpio.slice(2, 4), 16)
  const b = parseInt(limpio.slice(4, 6), 16)
  return `${r} ${g} ${b}`
}

function oscurecer(hex: string, factor: number): string | null {
  const limpio = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(limpio)) return null
  const r = Math.round(parseInt(limpio.slice(0, 2), 16) * factor)
  const g = Math.round(parseInt(limpio.slice(2, 4), 16) * factor)
  const b = Math.round(parseInt(limpio.slice(4, 6), 16) * factor)
  return `${r} ${g} ${b}`
}

// Normaliza un color a una claridad objetivo fija, aclarando (mezcla hacia
// blanco) o oscureciendo (escala hacia negro) según haga falta -- así el
// resultado se ve igual de parejo sin importar qué tan claro/oscuro sea el
// color de entrada que elija el salón. Se usa dos veces con objetivos
// distintos: uno alto para el fondo de página (el "papel", casi blanco) y
// uno más bajo para las líneas de la malla encima (deben notarse, como en
// el original rosado -- ver aplicarTemaSalon).
function normalizarClaridad(hex: string, claridadObjetivo: number): string | null {
  const limpio = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(limpio)) return null
  const r0 = parseInt(limpio.slice(0, 2), 16)
  const g0 = parseInt(limpio.slice(2, 4), 16)
  const b0 = parseInt(limpio.slice(4, 6), 16)
  const claridadActual = luminanciaYiq(hex)
  let r: number, g: number, b: number
  if (claridadActual <= claridadObjetivo) {
    const factor = Math.min(0.92, Math.max(0, (claridadObjetivo - claridadActual) / (255 - claridadActual || 1)))
    r = r0 + (255 - r0) * factor
    g = g0 + (255 - g0) * factor
    b = b0 + (255 - b0) * factor
  } else {
    const factor = claridadObjetivo / claridadActual
    r = r0 * factor
    g = g0 * factor
    b = b0 * factor
  }
  return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`
}

function luminanciaYiq(hex: string): number {
  const limpio = hex.trim().replace('#', '')
  const r = parseInt(limpio.slice(0, 2), 16)
  const g = parseInt(limpio.slice(2, 4), 16)
  const b = parseInt(limpio.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000
}

// Texto legible sobre un fondo arbitrario (fórmula YIQ) -- así un salón
// puede poner el color que quiera de "principal" (aunque no sea oscuro) y
// el sidebar sigue siendo legible en vez de romperse.
function textoLegibleSobre(hex: string): string {
  return luminanciaYiq(hex) >= 140 ? '17 17 17' : '255 255 255'
}

// Para la Consola: aviso suave si los dos colores que eligió el operador
// quedan muy parecidos en claridad (no bloquea el guardado, solo sugiere).
export function coloresContrastanPoco(hexPrimario: string, hexSecundario: string): boolean {
  return Math.abs(luminanciaYiq(hexPrimario) - luminanciaYiq(hexSecundario)) < 60
}

export function aplicarTemaSalon(salon: Salon | null) {
  const root = document.documentElement.style
  // El color propio del cliente solo se aplica en Pro/Enterprise. En
  // Básico siempre se ve el dorado por defecto de KALLOS, aunque el salón
  // ya tenga colores guardados (quedan listos para cuando suba de plan, no
  // hace falta volver a configurarlos).
  const esPersonalizable = !!salon && salon.plan !== 'basico'
  const primario = esPersonalizable ? salon.color_primario : null
  const secundario = esPersonalizable ? salon.color_secundario : null

  if (!primario) {
    VARIABLES_A_PISAR.forEach((v) => root.removeProperty(v))
    return
  }

  const base = hexARgbTriple(primario)
  if (!base) return

  root.setProperty('--brand-500', base)
  root.setProperty('--brand-600', oscurecer(primario, 0.85) ?? base)
  root.setProperty('--brand-700', oscurecer(primario, 0.7) ?? base)

  // Sidebar/header: el color principal del salón como fondo, con texto
  // blanco o negro automático según qué tan claro sea (para que un color
  // claro elegido por error no deje el texto invisible).
  root.setProperty('--panel', base)
  root.setProperty('--panel-fg', textoLegibleSobre(primario))

  // El secundario es el acento que contrasta (resalta el link activo del
  // sidebar) -- si no lo puso, usamos el mismo principal como acento (se
  // ve monocromo pero no queda roto).
  const secundarioValido = secundario ? hexARgbTriple(secundario) : null
  root.setProperty('--accent2', secundarioValido ?? base)

  // Fondo de la página: el "papel" (--page-tint) queda casi blanco, y
  // encima la malla de líneas diagonales (--page-mesh) se nota bien --
  // como el original rosado de Yessica Arango, pero del color que elija
  // el salón. Los dos se normalizan a una claridad fija cada uno (no el
  // secundario tal cual) para que el resultado se vea igual de parejo sin
  // importar qué tan claro u oscuro sea el color que puso el salón.
  if (secundario) {
    const tinte = normalizarClaridad(secundario, 248)
    const malla = normalizarClaridad(secundario, 195)
    if (tinte) root.setProperty('--page-tint', tinte)
    if (malla) {
      root.setProperty('--page-mesh', malla)
      root.setProperty('--page-mesh-alpha', '0.35')
    }
  }
}
