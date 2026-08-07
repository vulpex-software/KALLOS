// Edge Function: le da al operador de plataforma una sesión REAL como el
// superadmin de un salón, para reproducir problemas de soporte. Corre con
// la service-role key (nunca en el frontend) -- valida todo server-side:
// quién llama, que sea operador, y a quién se está por suplantar.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (!token) return json({ error: 'No autenticado.' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Quién llama.
  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller?.user) return json({ error: 'Sesión inválida.' }, 401)

  // Debe ser operador de plataforma (no se confía en nada del cliente).
  const { data: esOperador } = await admin
    .from('plataforma_operadores')
    .select('user_id')
    .eq('user_id', caller.user.id)
    .maybeSingle()
  if (!esOperador) return json({ error: 'No autorizado.' }, 403)

  const { salon_id } = await req.json().catch(() => ({}))
  if (!salon_id) return json({ error: 'Falta salon_id.' }, 400)

  const { data: salon } = await admin
    .from('salones')
    .select('id, slug, nombre')
    .eq('id', salon_id)
    .maybeSingle()
  // El salón especial de la plataforma nunca es un destino válido.
  if (!salon || salon.slug === 'plataforma') return json({ error: 'Salón inválido.' }, 404)

  // El superadmin más antiguo y activo de ese salón.
  const { data: destino } = await admin
    .from('profiles')
    .select('id')
    .eq('salon_id', salon_id)
    .eq('rol', 'superadmin')
    .eq('activo', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!destino) return json({ error: 'Ese salón no tiene un superadmin activo.' }, 404)

  const { data: authUser, error: authUserErr } = await admin.auth.admin.getUserById(destino.id)
  if (authUserErr || !authUser?.user?.email) return json({ error: 'No se pudo resolver el correo.' }, 500)

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: authUser.user.email
  })
  // generateLink puede CREAR un usuario nuevo si el correo no existiera --
  // por eso el email se resolvió server-side desde profiles.id, nunca de
  // un input del cliente, y se reafirma la identidad acá antes de usarlo.
  if (linkErr || !link || link.user.id !== destino.id) {
    return json({ error: 'No se pudo generar el acceso.' }, 500)
  }

  await admin.from('plataforma_accesos_soporte').insert({
    operador_id: caller.user.id,
    salon_id,
    superadmin_id: destino.id
  })

  return json({ hashed_token: link.properties.hashed_token, salon_nombre: salon.nombre })
})
