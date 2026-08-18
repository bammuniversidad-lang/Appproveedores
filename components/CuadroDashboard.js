import { useMemo, useState } from 'react';
import { ThOrdenable, useOrdenTabla } from './TablaHeader';

// Cuadro de tabla reutilizable para el Dashboard: columnas redimensionables
// y ordenables (igual que en Compras) y, si se le pasa `campoFiltro` +
// `alSeleccionarFila`, cada fila se puede hacer clic para filtrar todos los
// demás cuadros del Dashboard (estilo Power BI / filtro cruzado).
export default function CuadroDashboard({ titulo, columnas, filas, formateador, colorCelda, campoFiltro, valorSeleccionado, alSeleccionarFila }) {
  const [orden, setOrden] = useState(null);
  const [anchos, setAnchos] = useState({});
  const ordenarFilas = useOrdenTabla();

  function alOrdenar(clave) {
    setOrden((prev) => {
      if (prev?.clave === clave) return { clave, direccion: prev.direccion === 'asc' ? 'desc' : 'asc' };
      return { clave, direccion: 'asc' };
    });
  }

  function alRedimensionar(clave, ancho) {
    setAnchos((prev) => ({ ...prev, [clave]: ancho }));
  }

  const filasOrdenadas = useMemo(() => ordenarFilas(filas || [], orden), [filas, orden]);

  return (
    <div className="panel-dashboard">
      {titulo && <h3>{titulo}</h3>}
      <div style={{ maxHeight: 320, overflow: 'auto' }} className="contenedor-cuadro-dashboard">
        <table>
          <thead>
            <tr>
              {columnas.map((c) => (
                <ThOrdenable
                  key={c.clave}
                  clave={c.clave}
                  etiqueta={c.etiqueta}
                  orden={orden}
                  alOrdenar={alOrdenar}
                  ancho={anchos[c.clave] || c.anchoInicial || 150}
                  alRedimensionar={alRedimensionar}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {filasOrdenadas.length === 0 ? (
              <tr><td colSpan={columnas.length} style={{ textAlign: 'center', opacity: 0.7 }}>Sin datos.</td></tr>
            ) : (
              filasOrdenadas.map((f, i) => {
                const valorFila = campoFiltro ? f[campoFiltro] : null;
                const activa = campoFiltro && valorSeleccionado === valorFila;
                return (
                  <tr
                    key={i}
                    onClick={alSeleccionarFila ? () => alSeleccionarFila(campoFiltro, valorFila) : undefined}
                    className={alSeleccionarFila ? 'fila-clicable' : ''}
                    style={activa ? { backgroundColor: '#bbdefb' } : undefined}
                    title={alSeleccionarFila ? 'Clic para filtrar los demás cuadros por esta fila' : undefined}
                  >
                    {columnas.map((c) => {
                      const ancho = anchos[c.clave] || c.anchoInicial || 150;
                      const claseColor = colorCelda?.[c.clave] ? colorCelda[c.clave](f[c.clave]) : '';
                      const valor = formateador?.[c.clave] ? formateador[c.clave](f[c.clave]) : f[c.clave];
                      return (
                        <td
                          key={c.clave}
                          className={claseColor}
                          style={{ width: ancho, minWidth: ancho, maxWidth: ancho, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={String(f[c.clave] ?? '')}
                        >
                          {c.clave === 'clasificacion' && f[c.clave]
                            ? <span className={`badge badge-${f[c.clave]}`}>{f[c.clave]}</span>
                            : valor}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Reglas de color estándar reutilizables (verde/amarillo/rojo metalizado),
// iguales a las de Compras.
export function colorPorNsValor(v) {
  const n = Number(v || 0) * 100;
  if (n >= 97) return 'celda-verde-metal';
  if (n >= 90) return 'celda-amarilla-metal';
  return 'celda-roja-metal';
}

export function colorPorPorcentajePendiente(v) {
  const n = Number(v || 0) * 100;
  if (n <= 3) return 'celda-verde-metal';
  if (n < 10) return 'celda-amarilla-metal';
  return 'celda-roja-metal';
}
