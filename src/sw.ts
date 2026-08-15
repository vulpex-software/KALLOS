/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] }

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// vite.config.ts pide registerType 'autoUpdate', pero con la estrategia
// 'injectManifest' vite-plugin-pwa NO inyecta esto solo -- hay que ponerlo
// a mano acá. Sin estas dos líneas el service worker nuevo se instala pero
// se queda "esperando", y el viejo sigue sirviendo el JS precacheado hasta
// que se cierran TODAS las pestañas de la app. En la práctica eso dejaba a
// las usuarias corriendo código de hace días contra una base de datos ya
// migrada (ej. mandando la columna 'obsequio' cuando ya se llamaba
// 'obsequios'), con errores imposibles de entender desde la pantalla.
self.skipWaiting()
clientsClaim()

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
