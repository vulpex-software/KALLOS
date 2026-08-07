/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] }

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Muestra la notificación push cuando llega desde el servidor.
self.addEventListener('push', (event) => {
  if (!event.data) return
  const { title, body, data } = event.data.json() as {
    title: string
    body: string
    data?: { url?: string }
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data,
    })
  )
})

// Al tocar la notificación: enfoca la pestaña existente o abre una nueva.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/jornada'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ('focus' in client) {
            ;(client as WindowClient).focus()
            return
          }
        }
        return self.clients.openWindow(url)
      })
  )
})
