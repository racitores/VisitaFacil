# Planificación semanal

El administrador abre **Semanal → Cambiar ajustes**, configura X semanas de antelación (0–52), técnicos, días laborables, máximo de visitas por técnico/día, minutos de intervención y origen/destino. Puede usar GPS o introducir coordenadas. Si activa la generación automática, el cron diario existente crea un borrador por semana y empresa; normalmente el lunes, con recuperación en ejecuciones posteriores. Está desactivada por defecto.

**Generar borrador semanal** calcula el lunes de la semana actual en Europe/Madrid más X semanas hasta su domingo. Con X=0 excluye días ya pasados. Detecta revisiones anuales según última intervención/alta; incluye las atrasadas todavía en bolsa y excluye vencimientos posteriores al domingo. No mueve citas asignadas ni completadas. Las visitas ya asignadas consumen capacidad y minutos.

Ordena por vencimiento y elige el hueco compatible que menos distancia geográfica adicional aporta a una ruta de vecino más cercano, con desempate por fecha. Respeta disponibilidad, días excluidos y plazo de revisión; las visitas vencidas antes del periodo se permiten mostrando el retraso. Un cliente con otra visita activa asignada no recibe una segunda asignación.

Es una heurística geográfica: no representa un óptimo global ni calcula tráfico o minutos por carretera. Los minutos configurados corresponden a intervenciones. La consulta de ruta de la agenda sigue disponible para revisar desplazamientos.

El borrador muestra grupos, citas conservadas y motivos de exclusión. **Revisar y aprobar** aplica todas sus asignaciones en una transacción, revalidando versiones, disponibilidad, técnicos, rutas y capacidad bajo bloqueo por empresa. Si algo ha cambiado, se rechaza completo y debe regenerarse. Una segunda aprobación no duplica asignaciones.

Al devolver una visita a bolsa se excluye por defecto el día rechazado; el formulario permite desmarcarlo. Las respuestas de cambio/cancelación por WhatsApp también excluyen ese día. Desde Bolsa se pueden modificar disponibilidad y duración, asignar manualmente o pedir una única mejor opción.

## Persistencia y ejecución
Tablas nuevas: weekly_settings y weekly_runs. Configuración por empresa; borrador único por empresa/semana objetivo, con revisión incremental. El cron GET /api/cron/messages conserva autenticación Bearer CRON_SECRET, procesa hasta 20 empresas por ejecución y un presupuesto de 15 segundos para planificación. Cada empresa se marca con su semana de referencia después de guardar el borrador; los fallos pueden reintentarse. La configuración debe tener técnicos y coordenadas válidas.

El cron crea borradores y nunca los aprueba. No envía propuestas de cita automáticamente al aprobar. WhatsApp se procesa aparte solo si está configurado, y su ausencia no bloquea planificación.

## Demo
Un único enlace **Demo** en el menú abre /?demo=1 sin iniciar sesión. Clientes, Agenda, Bolsa y Semanal comparten el adaptador local. Las tareas automáticas y los envíos externos no funcionan en demo. Todo cambio queda en el navegador.

La base ampliada contiene 360 clientes ficticios: 120 con revisión en noviembre de 2026, 120 en diciembre y 120 en enero de 2027. Incluye tres técnicos, cinco duraciones, restricciones de disponibilidad y algunas citas ya acordadas. Los usuarios con la demo anterior conservan sus 89 registros y cambios; reciben los 360 nuevos sin duplicarlos. Restablecer demo vuelve a la base de 360, sin tocar otros datos del navegador ni ninguna empresa real.

Se reutilizan direcciones públicas exactas de bibliotecas de Madrid y referencias de ayuntamientos de Alcalá de Henares, Alcobendas y Getafe. Los nombres, contactos y unidades son ficticios; varias unidades comparten una referencia pública. No son domicilios de clientes reales ni contactos utilizables.

Fuentes:
- https://datos.madrid.es/dataset/201747-0-bibliobuses-bibliotecas (CC BY 4.0; direcciones ya incluidas en clientes.json).
- https://www.comunidad.madrid/centros/alcala-henares
- https://www.comunidad.madrid/centros/alcobendas
- https://www.comunidad.madrid/centros/getafe

## Directorio
Búsqueda sin distinguir tildes; filtros combinables por localidad, mes de próxima revisión, estado de visita y cliente activo/archivado. Orden por nombre, próxima revisión o localidad. Páginas de 10, 25 o 50 clientes; anterior, siguiente y salto de página. Cambiar filtros reinicia la página y conserva la selección al editar. La paginación es de presentación sobre el conjunto cargado por /state, no paginación SQL; para volúmenes de producción mayores queda pendiente trasladar filtros y paginación al servidor.
