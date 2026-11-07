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
