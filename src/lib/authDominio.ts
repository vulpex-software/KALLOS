// Las cuentas internas (Superadmin, dueña, administradora, manicuristas) y las
// clientas que se registran por cédula pueden iniciar sesión con un "usuario"
// corto en vez de un correo. Internamente Supabase usa correos, así que a un
// usuario sin "@" le agregamos este dominio compartido por toda la
// plataforma KALLOS.
//
// Es compartido (no por salón) a propósito para v1: cada perfil pertenece a
// UN solo salón (salon_id), así que un usuario/cédula ya tiene que ser único
// en toda la plataforma sin importar el dominio que se use. Resolver un
// dominio POR salón requeriría saber a qué salón pertenece alguien antes de
// que inicie sesión (selector de salón o subdominio) -- eso ya está en el
// roadmap futuro ("multi-dominio o multi-ruta", ver CLAUDE.md) y no hace
// falta para que el aislamiento de datos funcione: ese lo da RLS vía
// salon_id, no este truco de dominio.
export const DOMINIO_INTERNO = 'cuentas.kallos.app'

export function normalizarCorreoOUsuario(entrada: string): string {
  const valor = entrada.trim()
  if (valor.includes('@')) return valor.toLowerCase()
  return `${valor.toLowerCase()}@${DOMINIO_INTERNO}`
}
