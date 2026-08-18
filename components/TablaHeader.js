import { useRef } from 'react';

// Encabezado <th> que se puede arrastrar para cambiar de ancho y hacer
// clic para ordenar. Se usa en Pendientes y en los cuadros del Dashboard.
export function ThOrdenable({ clave, etiqueta, ancho, alRedimensionar, orden, alOrdenar }) {
  const arrastrando = useRef(null);

  function iniciarResize(e) {
    e.preventDefault();
    e.stopPropagation();
    arrastrando.current = { x: e.clientX, anchoInicial: ancho || 140 };

    function mover(ev) {
      if (!arrastrando.current) return;
      const delta = ev.clientX - arrastrando.current.x;
      const nuevo = Math.max(60, arrastrando.current.anchoInicial + delta);
      alRedimensionar(clave, nuevo);
    }
    function soltar() {
      arrastrando.current = null;
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
    }
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
  }

  const indicador = orden?.clave === clave ? (orden.direccion === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <th
      className={alOrdenar ? 'ordenable' : ''}
      style={{ width: ancho, minWidth: ancho }}
      onClick={alOrdenar ? () => alOrdenar(clave) : undefined}
    >
      {etiqueta}{indicador}
      {alRedimensionar && <span className="manija-columna" onMouseDown={iniciarResize} />}
    </th>
  );
}

// Hook simple para llevar el estado de orden (clave + dirección) de una tabla.
export function useOrdenTabla(filas, ordenInicial) {
  return function ordenar(filas2, orden) {
    if (!orden) return filas2;
    const { clave, direccion } = orden;
    const copia = [...filas2];
    copia.sort((a, b) => {
      const va = a[clave];
      const vb = b[clave];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return direccion === 'asc' ? va - vb : vb - va;
      }
      return direccion === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return copia;
  };
}
