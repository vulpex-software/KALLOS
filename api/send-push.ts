import type { VercelRequest, VercelResponse } from '@vercel/node'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

// Configuración VAPID — variables en Vercel (no en el repo).
webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL ?? 'soporte@kallos.app'}`,
  process.env.VAPID_PUBLIC_KEY ?? '',
  process.env.VAPID_PRIVATE_KEY ?? ''
)

// Cliente con service_role para leer push_subscriptions (bypasa RLS).
const supabase = createClient(
  process.env.VITE_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // Sin esto, cualquiera que encuentre esta URL podría mandar notificaciones
  // arbitrarias a cualquier profesional. Solo admin/superadmin autenticados
  // pueden disparar un push (son los únicos que agendan/asignan citas).
  const authHeader = req.headers.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return res.status(401).json({ error: 'No autenticado.' })

  const { data: userData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !userData?.user) {
    return res.status(401).json({ error: 'Sesión inválida.' })
  }

  const { data: llamante } = await supabase
    .from('profiles')
    .select('rol, salon_id')
    .eq('id', userData.user.id)
    .single()

  if (!llamante || (llamante.rol !== 'admin' && llamante.rol !== 'superadmin')) {
    return res.status(403).json({ error: 'No autorizado.' })
  }

  const { empleada_id, titulo, cuerpo, url } = req.body as {
    empleada_id: string
    titulo: string
    cuerpo: string
    url?: string
  }

  if (!empleada_id || !titulo || !cuerpo) {
    return res.status(400).json({ error: 'Faltan campos requeridos.' })
  }

  // Este endpoint usa service-role (salta RLS): sin este chequeo, un
  // admin/superadmin de un salón podría mandar notificaciones a personal de
  // OTRO salón con solo adivinar/enumerar un empleada_id.
  const { data: destino } = await supabase
    .from('profiles')
    .select('salon_id')
    .eq('id', empleada_id)
    .single()

  if (!destino || destino.salon_id !== llamante.salon_id) {
    return res.status(403).json({ error: 'Ese usuario no pertenece a tu salón.' })
  }

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', empleada_id)

  if (error || !subs || subs.length === 0) {
    return res.status(200).json({ sent: 0, reason: 'Sin suscripción registrada.' })
  }

  const payload = JSON.stringify({
    title: titulo,
    body: cuerpo,
    data: { url: url ?? '/jornada' },
  })

  let sent = 0
  for (const row of subs) {
    try {
      await webpush.sendNotification(
        JSON.parse(row.subscription as string) as webpush.PushSubscription,
        payload
      )
      sent++
    } catch (e) {
      // Si la suscripción expiró (410 Gone), la eliminar para limpiar.
      const err = e as { statusCode?: number }
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('user_id', empleada_id)
      }
      console.error('[push] error al enviar:', e)
    }
  }

  return res.status(200).json({ sent })
}
