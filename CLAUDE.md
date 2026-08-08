# KALLOS — contexto del proyecto

## Qué es esto

KALLOS es la evolución comercial de un sistema de gestión que se construyó
originalmente para un solo salón: **Yessica Arango Nail & Beauty Experts**
(dueña en Cartagena, salón en Bogotá). Ese sistema sigue vivo, en producción,
en un repositorio y despliegue **completamente separados**
(`yessica-arango-app.vercel.app`) — esta carpeta es una **copia** del código
tal como estaba el 2026-08-06, sin `.git`, sin `node_modules`, pensada como
punto de partida para convertirla en un producto multi-salón (multi-tenant).

**No toques el proyecto de Yessica Arango desde aquí.** Son bases de datos
Supabase distintas y deben seguir siéndolo — si alguna vez se comparte el
mismo proyecto de Supabase entre los dos, se mezclarían clientas, citas y
dinero de ambos negocios.

## Stack

React 18 + Vite + TypeScript + Tailwind (PWA instalable) · Supabase
(Postgres + Auth + Storage + RLS + funciones/triggers) · Vercel (deploy
automático al hacer push a `main`) · funciones serverless en `/api/*.ts`
(Vercel Node) para notificaciones push (VAPID + `web-push`).

## Estado actual del código (single-tenant, listo para copiar el patrón)

Es un sistema completo y probado en producción para UN salón, con 4 roles
(`superadmin`=dueña, `admin`, `personal`=profesionales, `cliente`). Lee
`README.md` para el detalle de reglas de negocio. Funcionalidades ya
construidas y verificadas en vivo:

- Registro de trabajos con foto de evidencia, inmutable a nivel de base de
  datos (solo se puede "anular", nunca editar/borrar).
- Agenda de citas (`citas`) con abono, foto de comprobante, asignación de
  profesional, reprogramación, y una **nota interna** (`nota_interna`) que
  solo ve la profesional asignada.
- Notificaciones push reales (Web Push API) a la profesional cuando se le
  asigna una cita, + una campanita propia en el nav como respaldo si no dio
  el permiso del navegador.
- Flujo de dinero separado por diseño: la profesional nunca cobra
  (`registros_trabajo`) → el saldo pendiente lo cobra admin/dueña en
  "Cuentas por cobrar" (`cobros`) → se cuadra en "Cierre de caja"
  (`cierres_caja`) → comisión del 50% se calcula en Contabilidad/Reportes.
- **Saldo a favor / reembolsos** (`creditos_clientes`): cuando un abono
  termina siendo mayor al total (cambio a servicio más barato), se resuelve
  como crédito para la próxima cita o como devolución en efectivo (se
  refleja en Cierre de caja).
- **Inventario separado en dos**: `productos.tipo` = `vitrina` (se
  vende/presta, genera pago — Ventas/Préstamos) o `interno` (insumos de uso
  profesional, se descuentan por consumo sin costo — `consumos_internos`).
- **Préstamos y asignación de insumos** (`prestamos` + `prestamo_pagos`):
  dos pestañas — préstamos de dinero (genera deuda, con pagos parciales) y
  asignación de insumos (fiado de vitrina = deuda, asignado interno = sin
  costo ni deuda).
- Inventario, ventas de vitrina, préstamos/fiados a personal, permisos,
  auditoría completa, manual de uso in-app (`public/manual.html`, filtrado
  por rol vía `?rol=`).

Todo lo anterior está **ligado a un solo salón implícito** — ninguna tabla
tiene todavía un concepto de "a qué salón pertenece este dato". Ese es
exactamente el trabajo pendiente para KALLOS.

## Estado del multi-tenant (implementado 2026-08-06)

Ya no es greenfield. Se implementó lo siguiente (ver plan en el historial de
conversación si hace falta el detalle de diseño):

1. **Tenant/salón**: tabla `salones` (id, nombre, slug, dominio_interno,
   activo, plan, color_primario/secundario, logo_url) + columna `salon_id`
   en las 18 tablas de negocio, incluida `profiles`. `prestamo_pagos`,
   `venta_pagos` y `push_subscriptions` heredan su `salon_id` por trigger
   `before insert` desde su fila padre (no confían en lo que mande el
   cliente). Un perfil pertenece a UN solo salón (sin tabla puente) —
   simplificación deliberada de v1.
2. **RLS re-escrito**: función nueva `mi_salon()` (mismo patrón que
   `mi_rol()`), y `salon_id = mi_salon()` añadido a cada policy de las 18
   tablas + `storage.objects`. Triggers `security definer` que cruzan tablas
   (stock de productos, auditoría, `profesionales_disponibles`,
   `admin_actualizar_acceso`) también validan el salón a mano, porque saltan
   RLS. Ver `supabase/schema.sql` (reescrito completo, ya no incremental).
3. **Onboarding**: sigue siendo manual/SQL (`supabase/crear_salon_superadmin.sql`,
   reemplaza a `crear_superadmin.sql`) — 3 pasos: crear fila en `salones`,
   crear el usuario en el Dashboard de Supabase con `salon_id` en los
   metadatos, promover a `superadmin`. **Onboarding self-serve sigue
   pendiente** (sigue siendo trabajo futuro).
4. **Billing**: sigue pendiente. La columna `salones.plan` (basico/pro/
   enterprise) deja el gancho listo, pero no hay Stripe ni estados de cuenta.
5. **Branding**: el nombre/colores por defecto de la plataforma ya no son
   "Yessica Arango"/rosa — son "KALLOS"/negro+dorado. La paleta (`brand-*`
   en Tailwind) se lee de variables CSS en `src/index.css` (`:root`), y
   `src/lib/theme.ts` las pisa en runtime si `salones.color_primario` está
   seteado — el mecanismo de branding por salón YA funciona de punta a
   punta, solo falta una UI para que cada salón edite su propio color (hoy
   se setea a mano en la base de datos). El nombre del salón (`salon.nombre`)
   ya se muestra dinámicamente en el header/nav en vez de estar hardcodeado.
   `public/manual.html` tiene sus colores actualizados pero su TEXTO todavía
   dice "Yessica Arango" (se dejó fuera de alcance a propósito, es contenido,
   no solo color).
6. **Multi-dominio o multi-ruta**: sigue pendiente. El login de personal
   (`src/lib/authDominio.ts`) usa un dominio interno ÚNICO y compartido por
   toda la plataforma (no por salón) a propósito, porque resolver el salón
   ANTES de autenticar requeriría subdominio o selector de salón — el
   aislamiento real de datos ya lo da RLS vía `salon_id`, no ese truco de
   dominio. El autoregistro de clientas sí resuelve su salón por URL
   (`/registro-cliente/:salonSlug`), porque ahí no hace falta login previo.

7. **Consola KALLOS** (implementada 2026-08-07): panel del OPERADOR de
   plataforma (Vulpex, no un salón cliente) en `/plataforma` — lista de
   salones vendidos con conteo de usuarios, alta de salón nuevo con un
   formulario (genera el superadmin y un "kit de entrega" copiable),
   suspender/reactivar (`salones.activo`), cambiar plan, editar
   contacto/notas de venta y color de marca del cliente.
   - Un operador es una fila en `plataforma_operadores` (sin policy de
     insert/update/delete — se administra solo por SQL, ver
     `supabase/crear_operador_plataforma.sql`). Su perfil vive en un salón
     especial `slug='plataforma'`, `activo=false`.
   - Función `es_operador()` + policies ADITIVAS sobre `salones`/`profiles`
     (nadie más gana visibilidad nueva) + tabla aparte
     `salones_detalle_venta` (los datos comerciales NO pueden vivir en
     `salones` porque esa tabla tiene una policy pública de select para
     resolver el slug sin sesión).
   - RPCs `plataforma_resumen_salones()` y
     `plataforma_promover_superadmin(uuid)` (el operador no es admin de
     ningún salón cliente, así que no puede hacer el update directo).
   - Probado en vivo: creación de salón end-to-end, suspensión (bloquea la
     resolución pública del slug, el operador lo sigue viendo para
     reactivar), y anti-fuga (un superadmin normal no ve `/plataforma` ni
     puede llamar los RPCs — confirmado a nivel de RLS, no solo de UI).

8. **Pagos, alta self-serve e impersonar** (implementadas 2026-08-08):
   - **Pagos**: `salones_pagos` (ledger, solo insert) +
     `salones_detalle_venta.fecha_proximo_vencimiento`. La Consola muestra
     un semáforo (rojo vencido, ámbar ≤7 días, verde más lejos/sin fecha)
     y un mini-form para registrar pagos. Sigue siendo 100% manual, sin
     Stripe — es organización del cobro, no automatización.
   - **Alta self-serve** (`/crear-salon`, público): RPC `crear_salon_self_serve()`
     (anon, valida/sanea todo server-side: nombre, slug con regex y
     palabras reservadas) crea el salón + `salones_detalle_venta`, y el
     frontend hace `signUp()` normal. `handle_new_user()` ahora asigna
     `rol='superadmin'` automáticamente al PRIMER perfil de un salón (con
     `for update` sobre `salones` para evitar que dos altas concurrentes
     contra el mismo salón nuevo queden ambas como superadmin) — los demás
     signUp() (Usuarios.tsx, Citas.tsx, RegistroCliente.tsx) siguen
     quedando `'cliente'` como antes, porque ya hay un perfil previo en su
     salón. **Hueco de abuso conocido y aceptado para v1**: sin
     CAPTCHA/rate-limit — cualquiera puede crear salones sin límite.
   - **Impersonar / "Entrar como"**: Edge Function
     `supabase/functions/plataforma-impersonar` (Deno, service-role) —
     valida que el llamante sea operador, resuelve el superadmin activo
     más antiguo del salón destino por `profiles.id` (nunca por un correo
     que mande el cliente), usa `admin.generateLink({type:'magiclink'})` +
     `auth.verifyOtp({token_hash: hashed_token, ...})` en el frontend para
     darle al operador una sesión REAL de esa persona. Queda auditado en
     `plataforma_accesos_soporte` (operador, salón, superadmin, cuándo).
     El frontend reemplaza la sesión EN EL MISMO tab (banner ámbar "Viendo
     como X — Salir"); al salir hace `signOut()` de verdad — el operador
     tiene que volver a loguearse con su propia clave (fricción aceptada a
     propósito, más simple/seguro que restaurar la sesión sola). La sirve
     el contenedor `edge-runtime` que ya levanta `npx supabase start` (se
     ve como `supabase_edge_runtime_KALLOS` en `docker ps`) -- **no hace
     falta correr `supabase functions serve` aparte**, ese comando es solo
     para desarrollo activo de la función con hot-reload. Con el stack
     local arriba (`supabase start`), la función ya está disponible; se
     mantiene sola, no depende de ningún proceso de una sesión de Claude.
   - Corrección de RLS que salió de esto: un salón suspendido ya no
     esconde su propia fila de `salones` a su propio superadmin (antes
     rompía el branding mientras estaba suspendido).

9. **Branding propio solo en Pro/Enterprise** (implementada 2026-08-09):
   `salones.color_primario` y `salones.logo_url` existen para cualquier
   salón, pero solo se APLICAN si `plan <> 'basico'` — el gate vive en el
   frontend (`src/lib/theme.ts` para el color, `src/lib/branding.ts` →
   `logoParaSalon()` para el logo), no en la base de datos: un salón
   Básico puede tener ambos campos guardados (quedan listos para cuando
   suba de plan) pero siempre se ve la marca KALLOS por defecto. Probado
   en vivo con "Entrar como": mismo color de prueba guardado en un salón
   Pro y uno Básico — el Pro lo mostró, el Básico se quedó en dorado.
   - Bucket de Storage `logos` (público — la descarga no pasa por RLS,
     necesaria para pantallas sin sesión como el autoregistro de
     clientas). Solo el operador puede subir/reemplazar (policy
     `es_operador()` en `storage.objects`), desde la Consola
     ("Contacto, notas y marca" → subir archivo). Ruta:
     `{salon_id}/logo.<ext>`.
   - **Nombre y eslogan propios** (agregado 2026-08-11): además de
     color/logo, un salón Pro/Enterprise también puede reemplazar el
     nombre "KALLOS" y el eslogan "The order behind the beauty" del header
     por los suyos (`salones.nombre` ya existía; se agregó
     `salones.eslogan`, columna nueva). Mismo gate de siempre —
     `src/lib/branding.ts`: `nombreParaSalon()`/`esloganParaSalon()`, plan
     `!= 'basico'` y el campo no vacío. Se edita desde la Consola
     ("Contacto, notas y marca ▾"), junto al color y el logo. Probado en
     vivo: Laura's Spa (Pro) mostró su propio nombre siempre y el eslogan
     de KALLOS por defecto hasta que se le puso uno propio.

12. **Sidebar izquierdo + segundo color de marca** (agregado 2026-08-12,
    a pedido explícito: diferenciarse visualmente del salón original y
    verse "muy profesional"). Cambios:
    - `Layout.tsx` dejó de ser una barra superior con 14 links en fila —
      ahora es un sidebar fijo en escritorio (`md:sticky md:top-0
      md:h-screen`, agrupado en "general / operación / administración"
      para superadmin, agrupado más simple para admin, sin agrupar para
      personal) y un panel deslizable (drawer con overlay) en móvil,
      abierto desde el mismo botón hamburguesa. La ayuda y la campanita de
      citas siguen siempre visibles en la barra superior de móvil (no
      quedan escondidas detrás del hamburguesa).
    - `salones.color_secundario` (la columna ya existía, sin usar) ahora
      se expone en `plataforma_resumen_salones()` y se edita desde la
      Consola junto al principal — dos inputs de color con swatch en vivo
      y un aviso (no bloqueante) si quedan muy parecidos en claridad.
    - `theme.ts`: `color_primario` ahora también pinta el fondo del
      sidebar (`--panel`) con texto blanco/negro calculado automático
      según la claridad de ese color (fórmula YIQ, así un color claro
      puesto por error no deja el texto invisible) -- `--panel-fg`.
      `color_secundario` alimenta tres variables del fondo de página:
      `--page-tint` (el "papel", casi blanco -- claridad objetivo 248/255)
      y `--page-mesh` + `--page-mesh-alpha` (las líneas diagonales encima,
      bien visibles -- claridad objetivo 195/255, opacidad 0.35). Los dos
      objetivos de claridad se logran con `normalizarClaridad()`, que
      aclara U OSCURECE según haga falta (no solo aclara) para que tanto
      el papel como la malla queden igual de parejos sin importar si el
      salón eligió un color pastel o uno bien saturado -- el resultado
      final es el estilo del salón original de Yessica Arango (papel pálido
      + malla diagonal del mismo tono bien visible encima), pero con el
      color que elija cada salón en vez de rosa fijo. `--accent2` (a toda
      intensidad, sin normalizar) sigue resaltando el link activo del
      sidebar. Sin `color_secundario`, todo cae de vuelta al dorado de
      KALLOS de siempre (`--page-mesh-alpha` por defecto es 0.05, la malla
      apenas se nota, como era antes de este cambio). Todo sigue gateado a
      Pro/Enterprise -- en Básico no cambia nada.
    - Iterado dos veces en base a feedback directo con capturas reales de
      la app: la primera pasada (fondo de página) reusaba la malla
      existente al 5% de opacidad (casi imperceptible) -- corregido a un
      wash de fondo visible. La segunda pasada (ese wash) resultó
      demasiado plano/liso ("no debe quedar azul claro [plano]") -- la
      usuaria pidió la malla más oscura/visible "como el original [de
      Yessica] que era rosado" pero del color que elija el salón --
      corregido a la versión final de arriba (papel pálido + malla
      bien visible encima, cada uno normalizado a su propia claridad).
    - Antes del código real se usó la herramienta de visualización para
      mostrar dos iteraciones del sidebar (sola, luego con dos tonos) y
      confirmar el rumbo.
    - Probado en vivo con tres secundarios de prueba en Laura's Spa (Pro),
      revertidos al terminar cada uno: `#DBEAFE` (azul pastel) → papel
      `rgb(244 249 255)` / malla `rgb(184 197 214)`; `#16A34A` (verde
      saturado) → papel `rgb(236 248 241)` / malla `rgb(158 217 180)`;
      `#E91E8C` (rosa, como la referencia) → papel `rgb(253 237 246)` /
      malla `rgb(246 166 210)` a 0.35 de opacidad -- los tres quedan
      parejos en contraste papel/malla sin importar la entrada, confirmado
      por CSS computado (la captura de pantalla del navegador no estuvo
      disponible en esta sesión, ver nota en la sección de screenshots).
    - **Selector de color en la Consola** (agregado a pedido, misma
      pantalla): cada input de hex tiene al lado un `<input type="color">`
      nativo del navegador (abre la ruleta de color del sistema operativo,
      sin salir a buscar el hexadecimal) + una fila de 8 pares
      principal/secundario ya armados (`PALETA_SUGERIDA` en
      `Plataforma.tsx`) que rellenan ambos campos con un clic, pensados
      para contrastar bien de entrada. Solo build verificado (`tsc` +
      `vite build` limpios) -- no se probó el clic en vivo porque esta
      sesión no tiene la contraseña del operador para loguearse en
      `/plataforma` desde el navegador.

Lo que queda pendiente, en orden sugerido: (a) CAPTCHA/rate-limit en el
alta self-serve, (b) billing/Stripe de verdad (hoy: registro manual de
pagos + semáforo), (c) subdominio real por salón, (d) recordatorios
automáticos de vencimiento por correo/WhatsApp, (e) que el propio salón
(no solo el operador) pueda subir su logo/editar su nombre, eslogan y
colores desde su propia cuenta (hoy: solo el operador, desde la Consola),
(f) el sidebar no tiene íconos por ítem (se hicieron a mano en HTML/CSS
puro para no agregar una librería de íconos nueva al proyecto).

10. **Reembolso solo superadmin + condonaciones** (implementadas
    2026-08-10, portadas del proyecto original de Yessica Arango): en
    "Cuentas por cobrar", devolver dinero de un saldo a favor
    (`creditos_clientes.resolucion='reembolso'`) ahora exige `es_super()`
    en la policy de insert (un admin normal solo puede dejarlo como
    crédito) — gateado también en el frontend (botón oculto + validación).
    Tabla nueva `condonaciones` (ledger inmutable, solo insert/select,
    solo superadmin) para eliminar un saldo PENDIENTE sin que cuente como
    cobro real — resta del `pendiente` calculado en
    `CuentasPorCobrar.tsx`, no toca `cobros` ni el cierre de caja.

    **Hallazgo crítico durante la prueba, ya corregido**: casi TODOS los
    `.insert()` del frontend a tablas de negocio (`cobros`,
    `creditos_clientes`, `cierres_caja`, `marcaciones`, `permisos`,
    `prestamos`, `citas` en 2 lugares, `ventas`, `servicios`, `obsequios`,
    `registros_trabajo`, `productos`, `consumos_internos`) NO mandaban
    `salon_id` — quedó pendiente desde la conversión a multi-tenant
    original. RLS los bloqueaba silenciosamente (o los insertaba con
    `salon_id` nulo si la columna lo permitiera, que no es el caso: todas
    son `not null`, así que fallaban). Además, las 5 pantallas que suben
    fotos a `evidencias` (Citas, PortalCliente, RegistroTrabajo, Ventas,
    CuentasPorCobrar) armaban la ruta sin el prefijo `{salon_id}/` que
    exige la policy del bucket. Ambos se corrigieron en todos los sitios
    -- si se agrega un `.insert()` nuevo a una tabla con `salon_id`, o un
    `.storage.upload()` nuevo al bucket `evidencias`/`logos`, hay que
    acordarse de esto explícitamente, no hay trigger que lo cubra (salvo
    `prestamo_pagos`/`venta_pagos`/`push_subscriptions`, que sí heredan
    solos vía trigger).

Nota de seguridad conocida y aceptada en v1: los checks de `salon_id` cubren
inserts directos y los triggers `security definer` que tocan otra tabla
(stock, auditoría). NO hay guard explícito contra que una fila de
`citas`/`registros_trabajo` referencie un `servicio_id` de OTRO salón vía FK
normal (Postgres no valida RLS en FKs) — el resto de RLS evita que eso sea
una fuga de datos real (la fila referenciada de otro salón no se puede leer
igual), pero sí podría producir un join roto. No se blindó explícitamente
por alcance/tiempo; si aparece en la práctica, la solución es un trigger de
guarda por cada FK cruzada, igual que se hizo para `productos`.

11. **Incidente 2026-08-07: "Entrar como" caído tras reinicio de
    Docker/PC.** El contenedor `supabase_edge_runtime_KALLOS` (el que sirve
    las Edge Functions, incl. `plataforma-impersonar`) salió con exit code
    255 durante un reinicio del sistema (el mismo evento que cambió la IP
    LAN ese día). A diferencia de los demás contenedores de `supabase
    start`, este quedó creado con `RestartPolicy=no`, así que no volvió a
    levantar solo aunque Docker Desktop sí arrancó los otros. Síntoma para
    el usuario: "Entrar como" fallaba con "no se pudo entrar al salón" (en
    realidad connection refused contra la función, no un error de lógica).
    Diagnóstico: `docker ps` no lo listaba; `docker ps -a` mostraba
    `Exited (255)`. Arreglo aplicado: `docker start
    supabase_edge_runtime_KALLOS` + `docker update --restart unless-stopped
    supabase_edge_runtime_KALLOS` para que sobreviva el próximo
    reinicio. Si "Entrar como" (o cualquier Edge Function) vuelve a fallar
    después de un reinicio del PC, este es el primer contenedor a revisar
    con `docker ps -a | findstr edge`.

## Producción (en vivo desde 2026-08-07)

KALLOS ya está desplegado de verdad, no es solo un plan:

- **App**: https://kallos-gamma.vercel.app (Vercel, proyecto `vulpex/kallos`,
  cuenta GitHub `vulpex-software`). Deploy automático: cada `git push` a
  `main` en `github.com/vulpex-software/KALLOS` dispara un build y deploy
  solo, no hace falta correr `vercel deploy` a mano salvo que se quiera
  forzar un deploy sin commit nuevo.
- **Base de datos**: proyecto Supabase Cloud `rwadambgkqrrvvzzjtxw`, región
  `us-east-1`. Esquema completo aplicado (25 tablas, todas las migraciones
  hasta `20260812000000_color_secundario_sidebar.sql`).
  - La conexión DIRECTA (`db.rwadambgkqrrvvzzjtxw.supabase.co:5432`) es
    IPv6-only y no es alcanzable ni desde Docker Desktop ni desde la red de
    casa del dueño del proyecto -- para correr SQL contra prod hay que usar
    el **connection pooler**: `postgresql://postgres.rwadambgkqrrvvzzjtxw:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`.
  - Edge Function `plataforma-impersonar` desplegada (`supabase functions
    deploy`, vinculado con `supabase link --project-ref rwadambgkqrrvvzzjtxw`
    usando un Personal Access Token de la cuenta, no la CLI login interactiva).
  - Operador fundador: `vulpexholdinggroup@gmail.com` (creado por API admin
    de Auth, no por el dashboard -- el botón "Add user" del dashboard le
    daba error a la usuaria y no se investigó la causa raíz).
  - **CRÍTICO, ya corregido (2026-08-08): `mailer_autoconfirm` estaba en
    `false`** (default de un proyecto Supabase Cloud nuevo). Toda la app
    depende de correos SINTÉTICOS que nadie puede confirmar de verdad --
    `usuario@cuentas.kallos.app` (staff/dueña con "usuario corto", ver
    `authDominio.ts`) y `cedula@cuentas.kallos.app` (clientas, ver
    `RegistroCliente.tsx`). Con confirmación de correo exigida, CUALQUIER
    cuenta creada por self-serve (`/crear-salon`), por la Consola
    ("Vender / crear salón") o por una clienta (`/registro-cliente/<slug>`)
    quedaba con sesión válida un instante pero **nunca podía volver a
    iniciar sesión** -- Login.tsx solo muestra "Usuario o contraseña
    incorrectos" para cualquier error, así que se veía exactamente como una
    contraseña mal guardada (por eso la confusión inicial). Se corrigió con
    la Management API: `PATCH /v1/projects/{ref}/config/auth
    {"mailer_autoconfirm": true}` (requiere el Personal Access Token, no las
    API keys del proyecto). Las cuentas que ya habían quedado atascadas se
    confirmaron a mano una por una (`PUT .../admin/users/{id}
    {"email_confirm": true}`) -- si aparece alguna cuenta vieja que "no
    recuerda su contraseña" y es de antes de esta fecha, probablemente es
    este mismo problema, no una contraseña real mal escrita.
  - **Otro hallazgo, no corregido**: en `/registro-cliente/<slug>`, el link
    "¿Ya tienes cuenta? Inicia sesión" antes solo navegaba a `/login` -- si
    el navegador ya tenía OTRA sesión guardada (una operadora probando, un
    computador compartido), `/login` la veía activa y rebotaba directo a
    esa cuenta en vez de mostrar el formulario. Corregido en
    `RegistroCliente.tsx` y `CrearSalon.tsx`: ese botón ahora hace
    `signOut()` antes de navegar a `/login` (mismo patrón que
    `salirDeImpersonar` en `Layout.tsx`).
- **Vercel env vars** (Production): `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY` -- las
  claves VAPID son nuevas (generadas con `web-push generate-vapid-keys`),
  el `.env` local todavía tenía un placeholder sin usar.
- **El `.env` local NO se tocó** -- sigue apuntando al Supabase local de
  Docker (`http://192.168.1.6:54321` o el que corresponda). Desarrollo local
  y producción son dos bases de datos completamente separadas a propósito
  (no se quiere que probar cosas localmente afecte datos de clientes
  reales). El stack de Docker local se paró (`supabase stop`, con backup de
  los datos) una vez confirmado que producción funcionaba -- para retomar
  desarrollo local: `npx supabase start` desde `KALLOS/`.
- **Pendiente**: dominio propio (hoy es el subdominio `.vercel.app` gratis),
  decidir si el desarrollo local eventualmente apunta a producción o se
  mantienen separados con datos de prueba propios.

### Cómo poner esto a andar (si hay que rehacerlo desde cero)

```bash
npm install
```

Para un proyecto Supabase nuevo (no reusar el de producción para pruebas):
copia `.env.example` a `.env`, corre `supabase/schema.sql` completo en el
SQL Editor (o por CLI/psql si el proyecto tiene IPv4 -- probar el pooler si
la conexión directa da "Network unreachable"). Los archivos `migracion_*.sql`
sueltos y `crear_superadmin.sql` en la raíz de `supabase/` son específicos
del proyecto original de Yessica Arango (single-tenant, sin `salon_id`) --
no aplican acá. Para dar de alta el primer salón + su superadmin en un
proyecto nuevo, usa `supabase/crear_salon_superadmin.sql` o el patrón de
`crear_operador_plataforma.sql` si es para un operador de plataforma.

## Convenciones y gotchas aprendidos (aplican también aquí)

- **Git**: no hay identidad de git configurada de forma persistente en el
  entorno de Bash. Commitear así: `git -c user.name="..." -c user.email="..." commit -m "..."`.
  Nunca `--amend`; siempre commits nuevos.
- **Build en Windows**: si la ruta del proyecto llega a tener espacios o
  caracteres especiales, los shims `.cmd` de `npm`/`npx` pueden fallar.
  Alternativa que siempre funciona: invocar los binarios de Node
  directamente — `node "node_modules/typescript/bin/tsc" -b` y
  `node "node_modules/vite/bin/vite.js" build`.
- **Migraciones SQL**: no hay ejecutor automático de migraciones. Cada
  cambio de esquema se escribe dos veces: (a) directo en `supabase/schema.sql`
  (fuente de verdad para instalaciones nuevas) y (b) como archivo
  `supabase/migracion_<nombre>.sql` idempotente (`create table if not exists`,
  y para políticas — Postgres no soporta `create policy if not exists`, hay
  que hacer `drop policy if exists ...; create policy ...;`) para aplicar a
  mano en el SQL Editor de un proyecto ya existente.
- **PWA / service worker**: usa `vite-plugin-pwa` con `strategies: 'injectManifest'`
  y un `src/sw.ts` propio (necesario para los listeners `push`/`notificationclick`
  de las notificaciones). `manual.html` está excluido del precache vía
  `injectManifest.globIgnores` — si algún día vuelve a aparecer en blanco,
  es casi seguro un problema de precache/navigateFallback, no del contenido.
- **Verificación de cambios en producción**: como el service worker cachea
  agresivamente, verificar un cambio recién desplegado requiere limpiar
  registrations + caches del navegador antes de recargar
  (`navigator.serviceWorker.getRegistrations()` + `caches.keys()/delete()`).
- **Secretos**: `SUPABASE_SERVICE_ROLE_KEY` y `VAPID_PRIVATE_KEY` van
  *solo* como env vars server-side en Vercel — nunca con prefijo `VITE_`,
  nunca en el repo. Cualquier endpoint en `/api/*` que use la service-role
  key todavía necesita su propia verificación de quién llama (ver
  `api/send-push.ts` como ejemplo: valida el JWT del caller y su rol antes
  de hacer nada).
