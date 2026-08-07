# Yessica Arango - Nail & Beauty Experts · Control de Trabajos

Developed by **Vulpex Software SAS**.

App web instalable (PWA) para que cada empleada registre los trabajos que realiza
(servicio, precio, cliente, método de pago, foto de evidencia), y la dueña pueda
ver todo en tiempo real desde donde esté, comparando lo registrado contra lo que
la administradora reporta en el cierre de caja diario.

## Por qué esto ayuda a tu problema concreto

- **Cada trabajo lo registra quien lo hizo**, en el momento, con foto. La
  administradora no interviene en ese paso.
- **Nadie puede editar ni borrar un registro** una vez creado (está bloqueado a
  nivel de base de datos, no solo en la pantalla). Solo tú puedes "anular" uno,
  dejando rastro de quién y por qué.
- **El cierre de caja lo llena la administradora**, pero el sistema compara
  automáticamente lo que ella reporta contra la suma de lo que las empleadas
  registraron ese día. Si no cuadra, te aparece una alerta en el panel.
- **Todo queda en una auditoría** que solo tú puedes ver.
- **Las citas también protegen el abono** (el dinero que se cobra por adelantado
  al agendar): una vez creada una cita, nadie puede editar el monto del abono ni
  borrar la cita, solo cambiar su estado (confirmada/completada/cancelada).

## ¿Tiene base de datos de usuarios? Sí

Sí. Cada persona que usa la app es un usuario real en **Supabase Authentication**
(con su correo/usuario y contraseña, cifrada — nadie, ni tú, ve las contraseñas),
y a cada uno le corresponde una fila en la tabla `profiles` con su **rol**. La
sesión es individual: cada quien ve solo lo que su rol permite, y todo lo que hace
queda ligado a su usuario en la auditoría.

## Roles

| Rol              | Qué puede hacer                                                                 |
|------------------|-----------------------------------------------------------------------------------|
| `cliente`        | Se registra sola desde la app, solicita citas y ve el estado de sus citas          |
| `personal`       | Marca su jornada (entrada/almuerzo/salida), registra sus trabajos, agenda y ve sus citas |
| `admin`          | Gestiona al personal: ve la asistencia de todas, agenda y asigna citas, hace el cierre de caja |
| `superadmin`     | La dueña: control total — panel con alertas, anular registros, usuarios, precios, todo |

Cuando alguien crea su cuenta, la base de datos le asigna automáticamente el rol
`cliente`. Desde **Usuarios** (superadmin) se le cambia el rol y, si es `personal`,
se marcan sus **especialidades**. **Ya no hay que copiar ningún UUID a mano.**

### Especialidades (Manicurista / Estilista / Lashista)

Cada profesional (`personal`) puede tener **una o varias** especialidades como
**etiqueta** — por ejemplo una chica con dos estudios lleva *Manicurista* y
*Estilista* a la vez. Importante: **la especialidad NO limita qué se le asigna.**
A cualquier profesional activa se le puede asignar cualquier servicio o cita, sin
importar cómo esté etiquetada. La etiqueta es solo informativa/organizativa.

### Control horario (jornada)

- Cada `personal` entra a **Mi jornada** y marca con un botón: **Entrada**,
  **Salgo a almorzar**, **Vuelvo del almuerzo** y **Salida**.
- Esas marcas son **inmutables** (no se editan ni se borran), igual que el resto
  del sistema, para que el horario sea confiable.
- El `admin` y la `superadmin` ven la asistencia de todo el personal por día en la
  pantalla **Asistencia** (entrada, almuerzo, regreso y salida de cada una).

## 1. Crear el backend (Supabase, gratis para este tamaño de negocio)

1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo.
2. Ve a **SQL Editor** y ejecuta todo el contenido de [`supabase/schema.sql`](supabase/schema.sql).
   Esto crea las tablas, los roles, las políticas de seguridad, los triggers que
   bloquean la edición/borrado de registros, y el bucket de fotos.
3. Ve a **Project Settings → API** y copia `Project URL` y `anon public key`.
4. En este proyecto, copia `.env.example` a `.env` y pega ahí esos dos valores.

## 2. Crear el usuario Superadmin (la primera cuenta)

Sigue [`supabase/crear_superadmin.sql`](supabase/crear_superadmin.sql). En resumen:

1. Supabase → **Authentication → Users → Add user**:
   - Email: `superadmin@yessica-arango.app`
   - Password: `Super123#`  ← contraseña temporal, **cámbiala después del primer ingreso**
   - Marca **"Auto Confirm User"**.
2. Ejecuta el `UPDATE` de ese archivo en el **SQL Editor** para volver ese perfil
   `superadmin`.
3. En la app inicia sesión escribiendo solo **`Superadmin`** (sin el correo) y la
   contraseña — la app le agrega sola el dominio interno.

Desde el Superadmin ya puedes dar de alta al resto del personal:

- Crea cada cuenta en **Authentication → Add user** (correo o usuario + contraseña,
  con "Auto Confirm"). Para usar un usuario corto en vez de correo, ponlo como
  `nombre@yessica-arango.app` y esa persona entrará escribiendo solo `nombre`.
- Entra a **Usuarios** en la app y cámbiale el rol (Personal, Admin, Super Admin).
  Si es Personal, marca sus especialidades (Manicurista / Estilista / Lashista, una
  o varias). El perfil ya existe solo, gracias al registro automático.

### Auto-registro de clientas (opcional)

La app **ya trae** la opción de que las clientas creen su propia cuenta (botón
"Crea tu cuenta" en el login) y **soliciten una cita** eligiendo el servicio, la
fecha y la hora. Esas solicitudes llegan a la pantalla **Citas** del personal como
"Sin asignar", y el admin/dueña le **asigna la profesional** con un clic.
Si prefieres no ofrecer esto todavía, simplemente no compartas el enlace de registro
con las clientas (o podemos ocultar el botón). Consúltalo con el negocio y me dices.

> Nota Supabase: si quieres que las clientas entren sin tener que confirmar el
> correo, ve a **Authentication → Providers → Email** y desactiva "Confirm email".
> Las cuentas del personal creadas con "Auto Confirm" no dependen de esto.

## 3. Cargar el catálogo de servicios

En el **SQL Editor** de Supabase ejecuta [`supabase/seed_servicios.sql`](supabase/seed_servicios.sql):
carga de una vez todo el catálogo real del negocio (Manicure, Sistemas/Extensiones,
Mantenimientos, Retiros y Reparaciones, Pedicura, Pestañas, Retoque de Pestañas,
Depilación, Cejas y un ítem "Adicional" de monto libre) con los precios actuales.

De ahí en adelante **no vuelvas a tocar SQL para cambiar precios**: entra a la
app como dueña, ve a la pantalla **Servicios**, y edita el precio de cualquier
servicio o agrega uno nuevo directamente desde ahí. El seed solo se necesita
la primera vez (o si algún día quieres recargar todo el catálogo de una sola vez).

## 4. Citas y WhatsApp

La pantalla **Citas** permite al personal (empleada, administradora o dueña)
agendar una cita con el mismo formato que ya usaban por WhatsApp: manicurista,
servicio, fecha, hora, clienta, abono y obsequio.

Además, si una **clienta** solicita su cita desde la app, aparece aquí como
**"Sin asignar"** y la administradora/dueña le **asigna la manicurista** con un
clic antes de confirmarla.

Al guardar una cita aparece un botón **"Enviar por WhatsApp"**: abre WhatsApp
(app o web) con el mensaje ya redactado, listo para mandarlo al celular de la
clienta (si registraste su teléfono) o para elegir el grupo del equipo donde
pegarlo. No requiere ninguna cuenta ni configuración adicional — funciona igual
que cuando ustedes escriben el mensaje a mano, solo que la app lo arma por ustedes
y además queda guardado como registro con su abono protegido.

Esto **no es una automatización real** (la app no envía ni recibe mensajes por
sí sola). Si más adelante quieren que el sistema mande recordatorios automáticos
o reciba confirmaciones de las clientas sin que nadie toque un botón, existe la
opción de conectar la **API oficial de WhatsApp Business Platform (Meta)**. Eso
implica que ustedes creen y verifiquen una cuenta de Meta Business (puede tardar
días en aprobarse) y asignen un número de teléfono exclusivo para esto — son
pasos que solo ustedes pueden hacer porque son su cuenta y su número. Avísame
cuando quieran dar ese paso y conecto esa parte.

## 5. Correr el proyecto en tu computador

```bash
npm install
npm run dev
```

Abre la URL que muestra la terminal (por defecto `http://localhost:5173`).

## 6. ¿Dónde se publica? (opciones de hosting)

Esta app tiene dos partes: el **frontend** (lo que se ve, archivos estáticos que
genera `npm run build`) y el **backend** (base de datos + usuarios + fotos, que ya
vive en **Supabase**). El frontend pesa muy poco (~120 KB), así que **cualquier**
hosting gratuito lo mueve sin problema. Opciones:

| Opción | Cómo es | Recomendado para |
|--------|---------|------------------|
| **Vercel** | Conectas el proyecto y en 1 minuto queda publicado con HTTPS y dominio gratis. Redepliega solo al actualizar. | **La más fácil — mi recomendación.** |
| **Netlify** | Prácticamente igual de simple que Vercel. | Alternativa equivalente. |
| **Cloudflare Pages** | Gratis, muy rápido. | Si ya usan Cloudflare. |
| **Firebase Hosting** | **Sí, Firebase puede publicarla** y NO le queda grande (solo sirve los archivos). | Si prefieren el ecosistema de Google. |

Sobre tu pregunta de **Firebase**: sí sirve, y no es "muy pesado" — al contrario,
Firebase Hosting solo alojaría los archivos del frontend; los datos seguirían en
Supabase. Lo que **no** conviene es rehacer todo el backend en Firebase (Firestore):
este sistema hace **cuadres de caja, comparaciones y auditoría**, que son mucho más
sólidos en una base de datos SQL como la de Supabase que en Firestore. Mi consejo:
**backend en Supabase + frontend en Vercel** (o Firebase Hosting si lo prefieren).

Pasos (Vercel, resumido):

```bash
npm run build
```

Sube el proyecto a Vercel (o conecta el repositorio de Git) y pon las variables
`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en su panel. Una vez publicado, cada
persona entra a la URL desde el navegador del celular y elige **"Agregar a pantalla
de inicio"** — queda instalada como una app normal (PWA), sin pasar por Google Play.

## Qué falta antes de usarlo en producción

Este es un MVP funcional, no un producto terminado. Antes de depender de él para
decisiones de dinero, conviene:

- Probarlo unos días en paralelo con el control actual, comparando resultados.
- Ajustar el catálogo de servicios y textos según cómo hablan en el salón.
- Revisar con un contador/abogado si necesitas retener estos datos (fotos,
  teléfonos de clientes) conforme a la Ley de Protección de Datos (Colombia).
- Si el volumen crece mucho, considerar convertir la vista de comparación en
  reportes exportables (Excel/PDF) para tus propios registros contables.

---

Developed by **Vulpex Software SAS**.
