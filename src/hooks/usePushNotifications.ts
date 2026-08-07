import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

const VAPID_PUB = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function base64ToUint8(b64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
  return buf.buffer
}

// Hook para profesionales (rol='personal'): solicita permiso de notificaciones
// y registra la suscripción push en Supabase una vez por dispositivo/sesión.
export function usePushNotifications() {
  const { profile } = useAuth()

  useEffect(() => {
    if (!profile || profile.rol !== 'personal') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (!VAPID_PUB) return

    let cancelled = false
    const userId = profile.id

    async function suscribir() {
      try {
        const permiso = await Notification.requestPermission()
        if (permiso !== 'granted' || cancelled) return

        const reg = await navigator.serviceWorker.ready
        let sub = await reg.pushManager.getSubscription()
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64ToUint8(VAPID_PUB!),
          })
        }
        if (cancelled) return

        await supabase.from('push_subscriptions').upsert(
          {
            user_id: userId,
            subscription: JSON.stringify(sub),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
      } catch (err) {
        console.warn('[push] no se pudo suscribir:', err)
      }
    }

    suscribir()
    return () => {
      cancelled = true
    }
  }, [profile?.id, profile?.rol])
}
