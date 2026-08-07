// Los montos en pesos se escriben como texto (no <input type="number">) para
// que se puedan teclear con puntos de miles (ej: "20.000"), como es costumbre
// en Colombia. Un <input type="number"> interpreta el punto como separador
// DECIMAL (formato de computador) y convierte "20.000" en 20, no en veinte
// mil — eso fue exactamente el bug que se reportó con un abono.

// Deja solo los dígitos de lo que se escribió (quita puntos, comas, espacios).
export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, '')
}

// Formatea los dígitos guardados con separador de miles, para mostrarlos en el input.
export function formatearPesosInput(valorDigitos: string): string {
  if (!valorDigitos) return ''
  return Number(valorDigitos).toLocaleString('es-CO')
}
