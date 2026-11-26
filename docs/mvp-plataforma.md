# VisitaFácil: plataforma y puesta en marcha

## Alcance implementado

Servidor Node/Express y PostgreSQL, desplegable como función en Vercel. Better Auth gestiona usuarios, contraseñas, sesiones con cookies y recuperación por correo. Cada petición comprueba la pertenencia a la empresa elegida. Roles: administración y técnico. Un usuario puede pertenecer a varias empresas; las invitaciones están ligadas al correo, se guardan como hash, caducan y se consumen una sola vez.

Clientes: alta, edición, archivado e importación atómica del JSON existente. Equipo y revisiones se guardan en el registro. Los vencimientos son anuales desde la última intervención o el alta, con ajuste del 29 de febrero. Generar revisiones incluye las atrasadas y no duplica un mismo cliente/vencimiento. Archivar conserva el historial y exige retirar primero las citas activas.

Agenda: una jornada por técnico/día, capacidad variable y minutos de trabajo disponibles. La asignación bloquea la empresa en una transacción: dos peticiones simultáneas no pueden ocupar el último hueco. Las intervenciones realizadas siguen ocupando su capacidad de ese día. Los técnicos solo consultan sus jornadas y sus clientes y registran sus intervenciones. Administración gestiona el resto.

Bolsa: visitas sin asignar, devoluciones con motivo, disponibilidad por intervalo, días de semana y fechas excluidas; duración configurable. Se permite asignar manualmente a un día/grupo y cancelar definitivamente una revisión. Completar añade la intervención al cliente, cierra la visita y permite generar el siguiente vencimiento anual. Se conserva un registro de cambios.

Agrupación: reutiliza el algoritmo geográfico dinámico del planificador existente, divide por el eje de mayor dispersión y compacta los grupos. Aplica capacidad, duración, disponibilidad y días ya ocupados; programa de lunes a viernes, hasta 90 días de búsqueda por grupo. Las visitas sin coordenadas o sin día compatible permanecen en bolsa. Las revisiones futuras se sitúan antes de su vencimiento; las atrasadas se recuperan en próximos días disponibles.

Sugerencia: devuelve una sola jornada compatible entre las existentes, la que tenga menor incremento estimado de recorrido geográfico. En empates prima la fecha. Comprueba capacidad, duración, disponibilidad y vencimiento; avisa de revisiones atrasadas. Es una heurística de proximidad, no un óptimo por carretera. El cálculo por carretera sigue disponible con OSRM y un máximo de 14 paradas. Los minutos de jornada son tiempo de intervención; no incluyen desplazamientos, descansos ni franjas horarias. Para esos límites se necesita una siguiente ampliación del modelo.

## Activación en Vercel

Preparado el 26/11/2026: `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` y `CRON_SECRET` ya están guardadas para **Production** en `caldera-gestion`. Los secretos están marcados como sensibles. Neon ya está conectado al proyecto `caldera-gestion` en Production: proyecto `visitafacil` (`bitter-lab-90677782`), rama `production`, PostgreSQL 17 en AWS Frankfurt. `DATABASE_URL` es agrupada y `DATABASE_URL_UNPOOLED` es directa para migraciones. Correo y WhatsApp requieren sus credenciales y configuración externa. No se han copiado secretos de producción a previews.


Proyecto previsto: `racitores-projects/caldera-gestion`. El repositorio también tiene conectado `caldera-gestion-dist`: conviene conservar un único despliegue de producción para evitar confusiones. No cambiar el Root Directory del proyecto: debe apuntar a la raíz del repositorio, donde están `package.json`, `api/` y `vercel.json`.

1. En Vercel → proyecto → Storage/Marketplace, crear o conectar **Neon PostgreSQL**. Elegir el plan y la región en la cuenta del propietario. Vincular su conexión PostgreSQL agrupada a `DATABASE_URL`. Esta activación requiere la cuenta de Vercel; el conector disponible no permite crear recursos de Marketplace.
2. Añadir las variables de acceso indicadas abajo a los entornos necesarios. Usar una base o rama Neon independiente para previews. Nunca vincular una preview de código no revisado a la BBDD de producción: el build ejecuta migraciones aditivas de aplicación y el esquema versionado de Better Auth.
3. Redeploy. `npm run build` prepara el esquema si están presentes las variables de BBDD y acceso. Si faltan, la demostración sigue disponible y la API de gestión devuelve servicio sin configurar. Un error real de migración hace fallar el build.
4. Abrir `/plataforma.html`, crear una cuenta y una empresa. Importar el JSON desde el formulario si se quieren datos ficticios; no se importan automáticamente a la BBDD.
5. En cada preview, `BETTER_AUTH_URL` debe corresponder al dominio estable que se usa para acceder a esa preview. El dominio tiene que coincidir también en los formularios y los correos; el servidor rechaza mutaciones desde otros orígenes.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión PostgreSQL agrupada, con TLS según la URL suministrada por Neon |
| `DATABASE_URL_UNPOOLED` | Conexión directa utilizada por las migraciones; si falta se utiliza `DATABASE_URL` |
| `BETTER_AUTH_URL` | URL HTTPS del despliegue, p. ej. `https://caldera-gestion.vercel.app` |
| `BETTER_AUTH_SECRET` | Secreto aleatorio de al menos 32 caracteres; generar fuera del código y conservar estable |
| `RESEND_API_KEY` | Credencial de Resend para recuperación de contraseñas |
| `MAIL_FROM` | Remitente autorizado en Resend |
| `CRON_SECRET` | Secreto aleatorio para autenticar la tarea de mensajes de Vercel |

El alta y el acceso funcionan sin proveedor de correo; la recuperación requiere Resend y un remitente verificado. Las invitaciones se comparten mediante un código copiable por administración. No existe una contraseña de administrador predeterminada. La creación de cuentas es pública; para una fase privada puede restringirse al piloto mediante protección de acceso en Vercel.

## WhatsApp

La implementación técnica está en `server/messaging.mjs`; la documentación funcional, costes orientativos e implicaciones siguen en [whatsapp-citas.md](whatsapp-citas.md). No está activada ninguna cuenta ni se han enviado mensajes reales desde esta implementación.

- Proponer una visita requiere administración, consentimiento explícito y configuración de WhatsApp. Crea un elemento único de outbox por visita/versión/tipo e intenta su envío inmediatamente.
- Repetir la propuesta no duplica el elemento. Reasignar o devolver una visita invalida sus envíos pendientes y cambia su versión. Un enlace de una versión anterior nunca confirma una nueva cita.
- Los botones Confirmar/Cambiar/No puedo actualizan la cita. Cambiar o rechazar devuelven a bolsa; no cancelan el mantenimiento definitivamente. La cancelación definitiva es una acción explícita de administración. El mensaje `BAJA` o `STOP` desactiva WhatsApp y no cancela citas.
- Webhook verificado con HMAC sobre el cuerpo original, comprobación del número receptor y deduplicación por identificador de mensaje. El teléfono del remitente debe coincidir con el del cliente. Las respuestas libres o antiguas se conservan para revisión humana.
- La tarea diaria de Vercel `0 7 * * *` crea recordatorios de citas confirmadas para mañana, usando fecha civil de Madrid. También vacía la cola. El worker tiene un presupuesto de 40 s más el envío en curso y procesa hasta 50 elementos; si queda cola se puede reintentar desde la interfaz. Una operación no puede exceder los 60 s de la función configurada.
- Los rechazos HTTP 429 se reintentan con espera y límite. Un timeout o error de servidor deja resultado incierto: requiere comprobar Meta antes de reenviar. No se promete entrega exactamente una vez a un proveedor externo. Una interrupción después de la aceptación puede requerir conciliación manual. `sent` significa aceptado por Meta, no entregado ni leído.

| Variable | Uso |
| --- | --- |
| `WHATSAPP_TOKEN` | Token de Cloud API con permisos adecuados |
| `WHATSAPP_PHONE_ID` | Identificador del número emisor de Meta |
| `WHATSAPP_GRAPH_VERSION` | Versión vigente y soportada de Graph API, p. ej. la indicada por Meta al configurar la app |
| `WHATSAPP_APP_SECRET` | Secreto de la app de Meta para verificar webhooks |
| `WHATSAPP_VERIFY_TOKEN` | Secreto de verificación elegido para el alta del webhook |
| `WHATSAPP_TEMPLATE_APPOINTMENT` | Nombre de plantilla aprobada de propuesta de cita |
| `WHATSAPP_TEMPLATE_REMINDER` | Nombre de plantilla aprobada de recordatorio |
| `WHATSAPP_LANGUAGE` | Código del idioma aprobado; por defecto `es` |

Ambas plantillas deben tener tres variables de cuerpo, en orden: nombre del cliente, fecha `AAAA-MM-DD` y nombre del grupo, más tres botones de respuesta rápida en orden Confirmar, Cambiar día, No puedo. El texto debe explicar cómo darse de baja. No introducir franjas horarias en la plantilla: este MVP todavía no las calcula.

Configurar en Meta el webhook `https://DOMINIO/api/whatsapp/webhook` y suscribir mensajes. El GET verifica el token; el POST valida `X-Hub-Signature-256`. El servicio usa un número central de plataforma; no hay credenciales distintas por empresa en esta versión. Verificar previamente que las plantillas y los consentimientos encajan con ese modelo.

## Desarrollo y verificación

Node 24 o posterior. `npm ci`, configurar variables en el entorno del proceso y ejecutar `npm run db:migrate` y `npm run dev`. No guardar secretos en el repositorio. Para producción se necesita PostgreSQL real; los clientes y agendas de la aplicación no se guardan en JSON ni en localStorage.

- `npm run check`: sintaxis de servidor e interfaz.
- `npm test`: pruebas de dominio, autenticación real y API con PostgreSQL. En local usa PGlite (PostgreSQL WASM) con protocolo PG y un único socket; no acredita paralelismo entre conexiones. En GitHub Actions usa PostgreSQL 16 con un pool de varias conexiones.
- `npm run test:e2e`: flujo de navegador móvil con Playwright; requiere `npx playwright install chromium` o `CHROMIUM_PATH` hacia una instalación existente. Se ejecuta en un proceso separado porque prepara su propia BBDD.

No usar `TEST_DATABASE_URL` sobre una BBDD con datos útiles: las pruebas crean usuarios y empresas. Las cuentas de prueba son ficticias y los proveedores externos se sustituyen únicamente dentro de los tests. La prueba de WhatsApp no acredita plantillas aprobadas, entregas reales ni configuración de Meta.

## Pendiente de activación externa

Configurar correo; registrar número, token y plantillas de WhatsApp; probar con un teléfono autorizado del piloto. Estas tareas requieren recursos o credenciales del propietario y no se sustituyen por valores ficticios. Validar aislamiento, acceso y copia de seguridad con la BBDD de producción antes de incorporar datos reales.

El esquema de Better Auth está generado desde la dependencia fijada en `package-lock.json` y se guarda en `server/auth-schema.sql`. Se aplica dentro de la misma transacción y bloqueo de migración que el esquema de negocio, con registro de versión. Al actualizar Better Auth, revisar el SQL y preparar una migración incremental; no basta con actualizar la dependencia o sobrescribir el esquema inicial. El generador `node scripts/generate-auth-schema.mjs` siempre utiliza una BBDD temporal vacía.

## Conexión activada en Neon

El recurso pertenece a la cuenta de Neon del propietario (organización Ramón, plan Free); Vercel utiliza sus conexiones mediante variables sensibles, no mediante una integración de facturación de Marketplace. Proyecto `bitter-lab-90677782`, BBDD `visitafacil`, rama `production` (`br-crimson-rice-bg9lamnq`). Se mantiene una rama `staging` (`br-late-voice-bg9qg9mr`) para validar el esquema antes de producción. Las credenciales de producción solo están asignadas a Production en `caldera-gestion`.

La aplicación y PostgreSQL se ejecutan en Frankfurt (`fra1` / `aws-eu-central-1`). El cómputo de Neon está limitado a 0,25 CU con suspensión por inactividad según el plan. Las migraciones de build y CLI prefieren `DATABASE_URL_UNPOOLED`; el tráfico de la aplicación conserva el pool de `DATABASE_URL`.

## Demo sin cuenta

Abrir `/?demo=1` o pulsar «Probar sin iniciar sesión» en la portada. Se copian los 89 clientes ficticios del JSON a una empresa local independiente y se preparan sus revisiones pendientes hasta final de año. Clientes, agenda, bolsa, sugerencias e intervenciones se guardan en `localStorage`, clave `visitafacil-demo-v1`, solo en ese navegador y origen. No se accede a `/api`, Neon, EPA ni a ninguna sesión real; no se envían mensajes ni invitaciones.

«Restablecer demo» pide confirmación antes de regenerar únicamente los datos de esa demo. «Salir de demo» vuelve al acceso normal y conserva los cambios locales. La demo no sustituye una copia de seguridad: borrar datos del navegador o cambiar de dispositivo pierde ese estado. Las consultas explícitas de direcciones/rutas mantienen Photon y OSRM; usar datos ficticios en esta modalidad. Las reglas de planificación de servidor y demo comparten módulos puros para evitar divergencias.

La planificación semanal con X semanas de antelación se describe en [planificacion-semanal.md](planificacion-semanal.md); aún requiere implementar el proceso periódico y el límite estricto de semana.
