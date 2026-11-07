# Caldera Gestión

Primera versión de un directorio de clientes para un servicio técnico de calderas. Permite buscar por nombre, teléfono o dirección y consultar fichas e historiales.

## Ejecutar en local

Desde la raíz del proyecto:

```sh
python3 -m http.server 8000 --directory dist
```

Abre http://localhost:8000. El navegador carga el JSON por HTTP.

## Datos

`dist/clientes.json` contiene datos ficticios. Cada cliente tiene un identificador único, nombre, teléfono, correo, dirección completa, fecha de alta e historial de revisiones. Cada revisión tiene una fecha y una descripción del trabajo. Las fechas usan el formato `AAAA-MM-DD`. Para un cliente sin revisiones, usa `[]`.

La app lee el JSON en el navegador y ordena las revisiones de más reciente a más antigua. Esta versión es de consulta. Los visitantes con acceso a la app pueden descargar el JSON íntegro, así que está pensado para datos de prueba.

## Revisiones pendientes

La pantalla mensual calcula el siguiente vencimiento de cada cliente sumando un año a su última revisión registrada o, si aún no tiene revisiones, a su fecha de alta. Para un 29 de febrero, usa el 28 de febrero si el año siguiente no es bisiesto. El filtro abre en el mes actual según la hora peninsular española y muestra los vencimientos del mes y año seleccionados, ordenados por fecha. Los datos de prueba incluyen al menos tres vencimientos por mes de 2026.

## Planificador de ruta

En Revisiones pendientes, selecciona las visitas del mes e introduce origen y destino. Con el destino vacío se calcula la vuelta al origen. Si no se puede verificar un portal de origen o destino, se indica cuando se usa un punto aproximado de esa calle. Los campos aceptan direcciones o coordenadas en formato `latitud, longitud`. El botón «Usar mi ubicación» pide permiso al navegador y rellena el origen con las coordenadas del dispositivo. La opción de recordar conserva el último origen y destino en el mismo navegador. Al desmarcarla, se borran las ubicaciones guardadas y se conserva esa preferencia.

El planificador consulta a Photon para las direcciones y a OSRM/FOSSGIS para las distancias y tiempos estimados por carretera. Evalúa todos los órdenes posibles mediante programación dinámica, hasta 14 visitas por cálculo, y minimiza la suma de los kilómetros de los trayectos que OSRM propone entre puntos. La comparación usa el orden del listado mensual. No contempla tráfico en directo, peajes, horarios ni tiempo en casa del cliente. Las coordenadas de demostración corresponden a puntos de referencia. Se usan para las rutas de los clientes ficticios del JSON. Los servicios externos se consultan al pulsar «Calcular ruta».

## Jornadas por zona

En Revisiones pendientes, ajusta el máximo de visitas por día (entre 1 y 14). La app agrupa las visitas marcadas con coordenadas en el menor número de jornadas posible, equilibra su tamaño y las separa por cercanía geográfica. Cada jornada se puede cargar en el planificador existente, que sigue calculando por carretera con el origen y destino configurados. Los grupos son propuestas, sin fechas asignadas.

Noviembre de 2026 tiene 50 visitas ficticias en 30 localidades de la Comunidad de Madrid, con 21 visitas en Madrid capital. Las direcciones de los 27 clientes ficticios de Madrid capital son referencias de bibliotecas públicas, tomadas del conjunto [Bibliotecas de Madrid](https://datos.madrid.es/dataset/201747-0-bibliobuses-bibliotecas) del Ayuntamiento de Madrid ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Se han adaptado el formato de las direcciones y la precisión de las coordenadas. El itinerario muestra calle, número y código postal para esos puntos. Los nombres y las revisiones de los clientes son ficticios. Para una dirección real se puede añadir `direccion.coordenadas` como `[longitud, latitud]`. Los clientes sin coordenadas se muestran aparte y se pueden incluir en el planificador manual.
