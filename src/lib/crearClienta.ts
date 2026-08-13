import { supabase, crearClienteEfimero } from './supabaseClient'
import { normalizarCorreoOUsuario } from './authDominio'

interface CrearClientaParams {
  salonId: string
  nombre: string
  apellidos?: string
  telefono: string
  // Si no se dan, el teléfono es el usuario Y la contraseña por defecto
  // (fácil de recordar) -- ambos quedan editables donde haya un formulario
  // visible (autorregistro, alta desde Usuarios); al crear la cuenta de
  // forma automática (ej. clienta nueva agendada desde Citas) simplemente
  // no se dan y se usa el teléfono para los dos.
  usuario?: string
  password?: string
  // true = usa un cliente Supabase efímero (no persiste sesión), para que
  // quien esté logueada (staff) no pierda su propia sesión al crear la
  // cuenta de la clienta.
  preservarSesion?: boolean
}

export async function crearClienta(params: CrearClientaParams): Promise<{ id: string | null; error: string | null }> {
  const telefono = params.telefono.trim()
  if (!telefono) return { id: null, error: 'Falta el teléfono para crear la cuenta.' }

  const usuario = (params.usuario?.trim() || telefono)
  const password = (params.password?.trim() || telefono)
  if (password.length < 6) return { id: null, error: 'La contraseña debe tener al menos 6 caracteres.' }

  const cliente = params.preservarSesion ? crearClienteEfimero() : supabase
  const { data, error } = await cliente.auth.signUp({
    email: normalizarCorreoOUsuario(usuario),
    password,
    options: {
      data: {
        nombre: params.nombre.trim(),
        apellidos: params.apellidos?.trim() || null,
        telefono,
        salon_id: params.salonId
      }
    }
  })
  if (error) {
    return {
      id: null,
      error: error.message.toLowerCase().includes('registered') || error.message.toLowerCase().includes('already')
        ? 'Ese usuario ya está registrado.'
        : 'No se pudo crear la cuenta: ' + error.message
    }
  }
  return { id: data.user?.id ?? null, error: null }
}
