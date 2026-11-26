# Planificar cada semana con X semanas de antelación

## Funcionamiento propuesto

Cada empresa define X semanas de antelación, días laborables, técnicos disponibles y capacidad de cada jornada. Cada lunes, el proceso calcula el lunes de la semana actual más X semanas. La semana objetivo va de ese lunes al domingo siguiente.

Ejemplo: ejecución el lunes 30/11/2026 con X=3 → semana del 21 al 27/12/2026. X=0 significa la semana en curso; X=1, la siguiente.

## A quién le toca

El vencimiento actual se calcula sumando un año a la última intervención registrada; si no hay intervenciones, al alta. Un 29 de febrero pasa al 28 si el siguiente año no es bisiesto. Por ahora todas las intervenciones del historial reinician ese cálculo: distinguir reparaciones de revisión anual requeriría añadir el tipo de intervención.

Se seleccionan las revisiones cuyo vencimiento cae en la semana objetivo y las anteriores que sigan pendientes. Solo se incluyen clientes activos y visitas sin asignar. Las visitas ya asignadas conservan su día; las realizadas y las canceladas definitivamente no se vuelven a proponer. Cada vencimiento de un cliente tiene una sola visita: repetir el proceso no crea duplicados.

Una revisión rechazada o aplazada vuelve a bolsa. Antes de incluirla se revisan sus nuevas fechas disponibles y cualquier exclusión; no se vuelve a proponer el día que el cliente acaba de rechazar si se ha registrado como excluido.

## Reparto y revisión humana

1. Reservar las citas ya confirmadas y las asignaciones manuales.
2. Priorizar las revisiones atrasadas y los vencimientos más próximos.
3. Agrupar por proximidad geográfica entre los días laborables de la semana objetivo, respetando técnico, número máximo de visitas, duración y disponibilidad del cliente.
4. Mantener en bolsa las visitas sin coordenadas, sin disponibilidad compatible o sin hueco. Mostrar el motivo y una única mejor alternativa cuando exista.
5. Guardar el resultado como borrador. Administración lo revisa antes de aprobar y proponer las citas por WhatsApp.

El proceso debe limitarse a la semana elegida, sin desplazar silenciosamente visitas a semanas posteriores. Al ejecutarse de nuevo, conserva las citas existentes y completa huecos. Un vencimiento atrasado debe mostrarse expresamente como fuera de plazo. Los minutos disponibles actuales contemplan intervenciones; los tiempos por carretera se consultan en el planificador y todavía no forman parte de la restricción de jornada.

La sugerencia individual actual estima cercanía geográfica. La ruta final de cada grupo se puede calcular por carretera con el planificador conservado. Las cancelaciones definitivas y las bajas de WhatsApp siguen siendo acciones distintas.

## Qué existe hoy

La app ya detecta revisiones hasta una fecha, evita duplicarlas, mantiene la bolsa y agrupa con fecha inicial, capacidad y disponibilidad. Para preparar un borrador manual se puede elegir el domingo objetivo en «Vencimientos hasta» y el lunes objetivo al agrupar. Hay que revisar el resultado: el agrupador actual considera toda la bolsa y puede crear jornadas más allá de esa semana.

Para cumplir exactamente el flujo semanal faltan la configuración de X por empresa, el filtro de vencimientos de la semana, el límite de fecha final del agrupador, los borradores semanales y la ejecución periódica. Este documento es el diseño pendiente; no hay una automatización semanal activa.
