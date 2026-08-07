// "Laura's Spa" -> "lauras-spa" (para el slug/URL de un salón). Compartido
// entre la Consola del operador (Plataforma.tsx) y el alta self-serve
// (CrearSalon.tsx).
export function generarSlug(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
