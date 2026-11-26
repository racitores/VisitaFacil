# ContactKeeper y futura importación de clientes

Documento de referencia actualizado el 26 de noviembre de 2026.

## Objetivo

Estudiar cómo extraer los contactos de ContactKeeper e incorporarlos a Caldera Gestión. Antes de implementar la importación hay que identificar la versión instalada y examinar una copia de su base de datos.

## Versiones y acceso a los datos

| Versión | Formato documentado | Cómo localizar los datos |
| --- | --- | --- |
| ContactKeeper clásico 1.5.0, de Tim Pieters | Archivo MDB | Según la reseña y el historial de cambios, pulsar la barra inferior abre el Explorador con la base de datos seleccionada. La versión 1.5.0 también permite exportar a CSV. |
| ContactKeeper de Microsoft Store, de LogicKite | SQLite local | El fabricante describe la copia de seguridad y restauración del archivo SQLite. Hay que comprobar la ubicación y el formato de la copia en la instalación concreta. |

La información del programa clásico procede de una fuente secundaria. El formato SQLite de la aplicación reciente está descrito por su fabricante. La legibilidad, el cifrado y el esquema de la base de datos concreta siguen pendientes de comprobar.

Fuentes consultadas el 26 de noviembre de 2026.

- [ContactKeeper de LogicKite](https://contactkeeper.app/).
- [Reseña e historial de ContactKeeper 1.5.0 en Softpedia](https://www.softpedia.com/get/Office-tools/Diary-Organizers-Calendar/ContactKeeper.shtml).

## Procedimiento propuesto

1. Identificar nombre, fabricante y versión desde la aplicación instalada.
2. Obtener una copia consistente mediante su función de copia de seguridad. Si se copia directamente el archivo, cerrar antes la aplicación.
3. Examinar esa copia en modo de lectura. Para MDB, usar una herramienta compatible con Access. Para SQLite, usar un lector compatible, si el archivo es legible.
4. Revisar tablas, relaciones, campos, fechas, codificación y posibles contactos duplicados. Comparar algunos registros con lo que muestra ContactKeeper.
5. Preparar una conversión reproducible con un informe de registros importados, omitidos y pendientes de revisar.

## Correspondencia con Caldera Gestión

Los campos siguientes son los del JSON actual. La correspondencia de origen se decidirá después de inspeccionar el archivo.

| Destino | Criterio propuesto |
| --- | --- |
| `id` | Asignar un identificador estable y conservar la relación con el identificador de origen para evitar duplicados al repetir una importación. |
| `nombre`, `telefono`, `email` | Importar los valores disponibles. Si hay varios teléfonos o correos, acordar cómo conservarlos. |
| `direccion` | Separar vía, piso y puerta, código postal, localidad, provincia y país. Revisar direcciones ambiguas. |
| `fechaAlta` | Usar una fecha de alta real cuando exista. Resolver los valores ausentes antes de activar el cálculo de vencimientos. |
| `revisiones` | Importar fechas y descripciones de intervenciones solo cuando se puedan identificar. Las notas generales requieren una correspondencia propia. |
| `direccion.coordenadas` | Guardar longitud y latitud verificadas para la agrupación y las rutas. |

El cálculo actual programa la próxima revisión un año después de la última revisión o del alta. Confundir una fecha de nacimiento con el alta o una nota con una intervención produciría vencimientos incorrectos.

## Datos pendientes

- Versión instalada y extensión del archivo.
- Acceso de lectura a una copia y estructura de sus tablas.
- Presencia de fechas de alta e historial de mantenimiento.
- Decisión entre importación puntual y actualizaciones periódicas.

## Publicación de datos reales

El JSON de `dist/clientes.json` se entrega al navegador como parte de la web. Antes de incorporar clientes reales hay que definir almacenamiento y control de acceso adecuados. Las bases de datos originales y las exportaciones con datos personales deben mantenerse fuera del repositorio y de los archivos publicados.
