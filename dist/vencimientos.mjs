// El JSON usa fechas civiles ISO (AAAA-MM-DD), sin hora ni zona horaria.
export function vencimientosAnuales(clientes) {
  return clientes.map(cliente => {
    const ultimaRevision = cliente.revisiones.reduce(
      (ultima, revision) => revision.fecha > ultima ? revision.fecha : ultima, ''
    );
    const [anio, mes, dia] = (ultimaRevision || cliente.fechaAlta).split('-');
    const siguienteAnio = Number(anio) + 1;
    const bisiesto = siguienteAnio % 4 === 0
      && (siguienteAnio % 100 !== 0 || siguienteAnio % 400 === 0);
    const siguienteDia = mes === '02' && dia === '29' && !bisiesto ? '28' : dia;
    return {
      cliente,
      ultimaRevision,
      fecha: [String(siguienteAnio).padStart(4, '0'), mes, siguienteDia].join('-')
    };
  }).sort((a, b) => a.fecha.localeCompare(b.fecha)
    || a.cliente.nombre.localeCompare(b.cliente.nombre, 'es'));
}
