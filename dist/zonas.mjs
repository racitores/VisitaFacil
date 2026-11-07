export function coordenadasCliente({ direccion }) {
  const point = direccion.coordenadas ?? direccion.coordenadasDemo;
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
    && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90 ? point : null;
}

function rango(puntos, eje) {
  const valores = puntos.map(punto => punto[eje]);
  return Math.max(...valores) - Math.min(...valores);
}

function dividirPorZona(puntos, tamanos) {
  if (tamanos.length === 1) return [puntos];

  const eje = rango(puntos, 'x') >= rango(puntos, 'y') ? 'x' : 'y';
  const ordenados = [...puntos].sort((a, b) => a[eje] - b[eje]);
  const medio = Math.floor(tamanos.length / 2);
  const izquierda = tamanos.slice(0, medio);
  const corte = izquierda.reduce((total, tamano) => total + tamano, 0);
  return [
    ...dividirPorZona(ordenados.slice(0, corte), izquierda),
    ...dividirPorZona(ordenados.slice(corte), tamanos.slice(medio))
  ];
}

function distanciaAlGrupo(punto, grupo, excluido) {
  return grupo.reduce((total, vecino) => vecino === excluido ? total : total
    + Math.hypot(punto.x - vecino.x, punto.y - vecino.y), 0);
}

function compactarGrupos(grupos) {
  // Los intercambios reducen la dispersión sin cambiar la carga de cada jornada.
  for (let paso = 0; paso < 4; paso++) {
    let cambios = false;
    for (const [indice, a] of grupos.entries()) {
      for (const b of grupos.slice(indice + 1)) {
        for (const [i, primero] of a.entries()) {
          for (const [j, segundo] of b.entries()) {
            const antes = distanciaAlGrupo(primero, a, primero) + distanciaAlGrupo(segundo, b, segundo);
            const despues = distanciaAlGrupo(segundo, a, primero) + distanciaAlGrupo(primero, b, segundo);
            if (despues >= antes - 1e-9) continue;
            a[i] = segundo;
            b[j] = primero;
            cambios = true;
            break;
          }
        }
      }
    }
    if (!cambios) break;
  }
}

// Reparte una zona en días contiguos y equilibrados según su eje de mayor extensión.
export function agruparVisitas(clientes, maxPorDia) {
  if (!Number.isInteger(maxPorDia) || maxPorDia < 1) {
    throw new RangeError('El máximo de visitas debe ser un entero positivo');
  }

  const localizados = [];
  const sinCoordenadas = [];
  for (const cliente of clientes) {
    const point = coordenadasCliente(cliente);
    if (point) localizados.push({ cliente, point });
    else sinCoordenadas.push(cliente);
  }
  if (!localizados.length) return { grupos: [], sinCoordenadas };

  const latitudMedia = localizados.reduce((sum, { point }) => sum + point[1], 0) / localizados.length;
  const escalaLongitud = Math.cos(latitudMedia * Math.PI / 180);
  const puntos = localizados.map(({ cliente, point }) => ({
    cliente, x: point[0] * escalaLongitud, y: point[1]
  }));
  const dias = Math.ceil(puntos.length / maxPorDia);
  const base = Math.floor(puntos.length / dias);
  const sobrantes = puntos.length % dias;
  const tamanos = Array.from({ length: dias }, (_, i) => base + Number(i < sobrantes));
  const grupos = dividirPorZona(puntos, tamanos);
  compactarGrupos(grupos);
  return { grupos: grupos.map(grupo => grupo.map(({ cliente }) => cliente)), sinCoordenadas };
}
