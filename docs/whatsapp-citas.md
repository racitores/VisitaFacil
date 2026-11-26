# Citas y recordatorios por WhatsApp

Documento de referencia del 26 de noviembre de 2026. La integración está propuesta y pendiente de implementar.

## Objetivo y alcance

Conectar Caldera Gestión con WhatsApp para proponer citas, recibir confirmaciones y recordar las visitas. La dificultad estimada es media. El trabajo principal está en la agenda, las respuestas y la consistencia de los envíos.

La app actual calcula vencimientos, grupos por zona y rutas. Cada grupo necesita una fecha y una franja horaria antes de generar una cita. El JSON de clientes debe evolucionar hacia almacenamiento persistente con acceso controlado para usar datos reales.

## Flujo propuesto

1. Seleccionar clientes con revisión pendiente y agrupar las visitas por zona.
2. Asignar técnico, día y franja horaria, teniendo en cuenta el desplazamiento y la duración de cada intervención.
3. Revisar las propuestas y autorizar su envío desde la aplicación.
4. Enviar el mensaje y registrar su estado.
5. Procesar respuestas para confirmar, cancelar o solicitar otro horario.
6. Enviar un recordatorio, por ejemplo el día anterior, solo para citas vigentes.
7. Mostrar incidencias y solicitudes de cambio para su resolución.

Una primera entrega permitiría revisar las citas y enviarlas con un botón. Después se añadirían los recordatorios automáticos y la gestión de respuestas.

## Canal y requisitos

La opción propuesta es WhatsApp Business Platform mediante la API oficial de Meta. Requiere configurar cuenta de empresa, número emisor, credenciales y facturación. La elegibilidad para conservar el mismo número en la app Business y en la API debe comprobarse durante el alta.

La política exige que el destinatario haya proporcionado su número y autorizado los mensajes. Hay que conservar evidencia del permiso y respetar las bajas. Para iniciar conversaciones se utilizarán las plantillas y categorías admitidas por Meta. Fuera de la ventana de atención de 24 horas posterior al último mensaje del cliente, el envío debe ajustarse a los requisitos vigentes de plantillas. El texto final requiere validación y, cuando corresponda, aprobación.

Fuentes oficiales.

- [Plataforma, alta y documentación de Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview/).
- [Política de mensajería de WhatsApp Business](https://whatsappbusiness.com/policy/).

## Mensajes previstos

Textos orientativos para preparar las plantillas.

| Tipo | Contenido y acciones |
| --- | --- |
| Propuesta de cita | Identificar empresa, revisión, fecha y franja. Acciones para confirmar o pedir cambio. |
| Confirmación | Indicar la cita aceptada y cómo contactar con el servicio. |
| Recordatorio | Recordar fecha y franja de una cita vigente. |
| Cambio o cancelación | Informar de la modificación y solicitar confirmación cuando sea necesaria. |

Un recordatorio asociado a una cita o un servicio acordado puede encajar en utilidad. Una invitación para contratar una nueva revisión podría clasificarse como marketing. El contexto y la clasificación de Meta determinan la tarifa.

## Costes de referencia para España

Estimación para destinatarios españoles, mensajes entregados y facturación en euros. Revisar la tarifa al activar el servicio y antes de presupuestar.

| Categoría | Referencia por mensaje |
| --- | --- |
| Utilidad | 0,0166 EUR |
| Marketing | 0,0585 EUR |

Estos importes proceden de la tabla en euros efectiva desde el 1 de octubre de 2026, publicada en una copia del documento de tarifas de Meta alojada por Gupshup. El precio efectivo puede variar por categoría, volumen y condiciones aplicables a la ventana de atención.

| Clientes al mes | Mensajes entregados con dos avisos por cliente | Coste si ambos son de utilidad |
| --- | --- | --- |
| 50 | 100 | 1,66 EUR |
| 200 | 400 | 6,64 EUR |
| 1.000 | 2.000 | 33,20 EUR |

Si cada cliente recibe una propuesta de marketing y un recordatorio de utilidad, el cálculo orientativo es 0,0751 EUR por cliente. Para 50 clientes serían 3,76 EUR redondeados.

Las estimaciones excluyen impuestos, mensajes adicionales, alojamiento, base de datos, número de teléfono y desarrollo. Una conexión directa a Meta evita la comisión de mensajería de un intermediario.

Twilio publica una comisión de 0,005 USD por mensaje entrante o saliente, además de los cargos de Meta. Las respuestas también cuentan para esa comisión. Revisar posibles cuotas, complementos y cargos de error del proveedor seleccionado.

Fuentes de precios consultadas el 26 de noviembre de 2026.

- [Tarifas y categorías oficiales de WhatsApp](https://whatsappbusiness.com/products/platform-pricing/).
- [Tabla EUR de octubre de 2026, copia alojada por Gupshup](https://www.gupshup.ai/resources/wp-content/uploads/2026/11/EUR_Oct2026.pdf).
- [Precios oficiales de Twilio para WhatsApp](https://www.twilio.com/en-us/whatsapp/pricing).

## Componentes técnicos propuestos

| Componente | Responsabilidad |
| --- | --- |
| Base de datos | Clientes, permisos, agenda, mensajes y trazabilidad. |
| Backend autenticado | Crear citas y solicitar envíos desde la interfaz. |
| Proceso programado | Detectar los avisos pendientes incluso con la web cerrada. |
| Cola de salida | Controlar ejecución concurrente, errores y reintentos. |
| API de Meta | Entregar los mensajes con el número de empresa. |
| Webhook | Recibir respuestas y estados de entrega. |
| Panel | Revisar propuestas, confirmaciones, bajas y fallos. |

Modelo mínimo sugerido.

- Cliente con teléfono internacional normalizado, permiso, fecha de autorización, origen del permiso y baja.
- Cita con cliente, técnico, fecha, zona horaria Europe/Madrid, franja, estado y versión.
- Mensaje con cita, tipo, plantilla, parámetros, fecha prevista, estado, identificador del proveedor e intentos.
- Evento entrante con identificador externo, tipo, fecha y resultado del procesamiento.

Estados de cita sugeridos son propuesta, confirmada, cambio solicitado, cancelada y realizada. Los estados del mensaje se gestionan por separado para distinguir aceptación de la API, entrega, lectura y error.

## Consistencia y operación

- Reclamar cada envío de forma atómica y usar una clave única por cita, versión y tipo de aviso.
- Antes de enviar, comprobar que la cita sigue vigente y que el cliente mantiene el permiso.
- Al modificar una cita, cancelar los avisos pendientes de su versión anterior.
- Deduplicar webhooks y verificar su autenticidad.
- Asociar los botones a la cita concreta. Una respuesta sobre una versión antigua debe pasar a revisión.
- Ante un timeout de envío, marcar el resultado como incierto y reconciliarlo antes de repetir. Una clave local evita duplicados internos, pero por sí sola no garantiza una única entrega en el proveedor.
- Guardar las credenciales en el servidor y restringir los endpoints y el acceso a los datos.
- Definir horario de envío, número máximo de reintentos y tratamiento de números sin WhatsApp.
- Al recibir una baja, detener los avisos correspondientes.

## Verificación antes de activar

Probar con destinatarios de prueba, sin contactos reales, los casos de confirmación, cancelación, cambio de fecha, baja, evento repetido, ejecución concurrente y fallo de conexión.

Comprobar que cada recordatorio usa la cita vigente, que los permisos se respetan y que un evento repetido no duplica acciones. Habilitar los envíos reales después de validar el número, las plantillas, la tarifa y la agenda.

## Decisiones pendientes

Elegir conexión directa a Meta o intermediario, número emisor, proveedor de base de datos y ejecución programada. Definir duración de las revisiones, franjas ofrecidas, alcance de los permisos y responsable de resolver cambios.

El presupuesto del desarrollo y del alojamiento está pendiente de concretar. La tabla de mensajes permite estimar consumo, pero no fija el coste total del servicio.
