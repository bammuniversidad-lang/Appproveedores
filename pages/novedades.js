import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { ThOrdenable, useOrdenTabla } from '../components/TablaHeader';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { primerDiaMesActual, hoyISO } from '../lib/fechas';

const TAMANO_PAGINA = 1000;

async function obtenerTodo(construirConsulta) {
  let desde = 0;
  let todas = [];
  while (true) {
    const { data, error } = await construirConsulta().range(desde, desde + TAMANO_PAGINA - 1);
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < TAMANO_PAGINA) break;
    desde += TAMANO_PAGINA;
  }
  return todas;
}

function moneda(v) {
  return `$ ${Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
}

const COLUMNAS_GRUPO = [
  { clave: 'co', etiqueta: 'C.O.', anchoInicial: 70 },
  { clave: 'proveedor', etiqueta: 'Proveedor', anchoInicial: 220 },
  { clave: 'nro_orden', etiqueta: 'Nro documento', anchoInicial: 130 },
  { clave: 'lineasCount', etiqueta: 'Líneas incumplidas', anchoInicial: 130 },
  { clave: 'valorSolicitado', etiqueta: 'Valor solicitado', anchoInicial: 140 },
  { clave: 'fechaOrden', etiqueta: 'Fecha de la orden', anchoInicial: 130 },
  { clave: 'fechaEntregaMax', etiqueta: 'Fecha entrega real', anchoInicial: 150 },
];

export default function Novedades({ tema, alternarTema }) {
  const { session } = useAuth();
  const [filas, setFilas] = useState([]);
  const [motivos, setMotivos] = useState([]);
  const [fechaInicio, setFechaInicio] = useState(primerDiaMesActual());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [expandido, setExpandido] = useState(null);
  const [motivoPorGrupo, setMotivoPorGrupo] = useState({});
  const [soloSinMotivo, setSoloSinMotivo] = useState(true);
  const [soloSinMotivoVista, setSoloSinMotivoVista] = useState(false);
  const [aplicando, setAplicando] = useState(null);
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

  async function cargarMotivos() {
    const { data } = await supabase.from('motivos').select('*').order('nombre');
    setMotivos(data || []);
  }

  async function cargarFilas() {
    setCargando(true);
    setMensaje('');
    try {
      const datos = await obtenerTodo(() => {
        let q = supabase.from('v_ns_proveedores').select('*').eq('observacion2', 'INCUMPLIDO');
        if (fechaInicio) q = q.gte('fecha_orden', fechaInicio);
        if (fechaFin) q = q.lte('fecha_orden', fechaFin);
        return q.order('co').order('proveedor');
      });
      setFilas(datos);
    } catch (e) {
      setMensaje(`Error cargando datos: ${e.message}`);
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarMotivos();
  }, []);

  useEffect(() => {
    cargarFilas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaInicio, fechaFin]);

  // Agrupa por C.O. + Proveedor + Nro documento (no por ítem, que es
  // demasiado dispendioso de revisar uno por uno) -- así se puede asignar
  // un motivo a todas las líneas incumplidas de una orden de una sola vez,
  // y se ve de un vistazo a qué documento pertenece cada incumplimiento.
  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const f of filas) {
      const clave = `${f.co}||${f.proveedor}||${f.nro_orden}`;
      if (!mapa.has(clave)) {
        mapa.set(clave, {
          co: f.co,
          proveedor: f.proveedor,
          nro_orden: f.nro_orden,
          lineas: [],
          lineasCount: 0,
          valorSolicitado: 0,
          sinMotivo: 0,
          fechaOrden: f.fecha_orden || null,
          fechaEntregaMin: null,
          fechaEntregaMax: null,
        });
      }
      const g = mapa.get(clave);
      g.lineas.push(f);
      g.lineasCount++;
      g.valorSolicitado += Number(f.valor_bruto || 0);
      if (!f.motivo_id) g.sinMotivo++;
      if (f.fecha_orden && (!g.fechaOrden || f.fecha_orden < g.fechaOrden)) g.fechaOrden = f.fecha_orden;
      if (f.fecha_entrega_real) {
        if (!g.fechaEntregaMin || f.fecha_entrega_real < g.fechaEntregaMin) g.fechaEntregaMin = f.fecha_entrega_real;
        if (!g.fechaEntregaMax || f.fecha_entrega_real > g.fechaEntregaMax) g.fechaEntregaMax = f.fecha_entrega_real;
      }
    }
    return [...mapa.values()];
  }, [filas]);

  const gruposVisibles = useMemo(() => {
    const base = soloSinMotivoVista ? grupos.filter((g) => g.sinMotivo > 0) : grupos;
    return ordenarFilas(base, orden || { clave: 'lineasCount', direccion: 'desc' });
  }, [grupos, orden, soloSinMotivoVista]);

  function textoFechaEntrega(g) {
    if (!g.fechaEntregaMax) return '-';
    if (g.fechaEntregaMin === g.fechaEntregaMax) return g.fechaEntregaMax;
    return `${g.fechaEntregaMin} a ${g.fechaEntregaMax}`;
  }

  async function asignarMotivoGrupo(grupo) {
    const clave = `${grupo.co}||${grupo.proveedor}||${grupo.nro_orden}`;
    const motivoId = motivoPorGrupo[clave];
    const motivo = motivos.find((m) => String(m.id) === String(motivoId));
    if (!motivo) return;

    const idsObjetivo = (soloSinMotivo ? grupo.lineas.filter((l) => !l.motivo_id) : grupo.lineas).map((l) => l.id);
    if (idsObjetivo.length === 0) {
      setMensaje(`La orden "${grupo.nro_orden}" de "${grupo.proveedor}" no tiene líneas pendientes de motivo.`);
      return;
    }

    setAplicando(clave);
    const { error } = await supabase
      .from('pedidos_detalle')
      .update({
        motivo_id: motivo.id,
        responsable_motivo: motivo.responsable,
        motivo_asignado_en: new Date().toISOString(),
        motivo_asignado_por: session?.user?.id,
      })
      .in('id', idsObjetivo);

    setAplicando(null);
    if (error) {
      setMensaje(`Error asignando motivo: ${error.message}`);
    } else {
      setMensaje(`Motivo "${motivo.nombre}" asignado a ${idsObjetivo.length} línea(s) de la orden "${grupo.nro_orden}" (${grupo.proveedor}).`);
      cargarFilas();
    }
  }

  const totalLineas = filas.length;
  const totalSinMotivo = filas.filter((f) => !f.motivo_id).length;
  const totalGruposSinMotivo = grupos.filter((g) => g.sinMotivo > 0).length;

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="novedades">
      <h2>Novedades por incumplimiento en tiempo de entrega</h2>
      <p style={{ opacity: 0.8, maxWidth: 760 }}>
        Agrupado por C.O. + Proveedor + Nro documento (no por ítem, que es demasiado
        dispendioso de revisar uno a uno): asigna un motivo de incumplimiento a TODAS las
        líneas incumplidas de una orden de una sola vez, en vez de tener que ir línea por
        línea en Nivel de servicio. Haz clic en los títulos de las columnas para
        ordenar. Esta pantalla es solo para el motivo de <b>incumplimiento en tiempo de
        entrega</b>. Para el motivo de <b>faltante de ítem</b> (cantidad pendiente), ve a
        Nivel de servicio — ahí puedes filtrar "Solo con cantidad pendiente" y asignar el
        motivo por línea o por selección múltiple.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <label>Desde</label><br />
          <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
        </div>
        <div>
          <label>Hasta</label><br />
          <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
        </div>
        <label style={{ marginTop: 16 }}>
          <input type="checkbox" checked={soloSinMotivo} onChange={(e) => setSoloSinMotivo(e.target.checked)} />
          {' '}Al asignar, solo tocar líneas sin motivo (no sobrescribir)
        </label>
        <button
          style={{ marginTop: 16 }}
          className={soloSinMotivoVista ? 'celda-amarilla-metal' : ''}
          onClick={() => setSoloSinMotivoVista((v) => !v)}
        >
          {soloSinMotivoVista ? `Mostrando solo sin motivo (${totalGruposSinMotivo})` : 'Ver solo sin motivo'}
        </button>
        <button style={{ marginTop: 16 }} onClick={cargarFilas} disabled={cargando}>
          {cargando ? 'Actualizando...' : 'Actualizar'}
        </button>
        <span style={{ marginTop: 16, fontSize: 12, opacity: 0.75 }}>
          {totalLineas} línea(s) incumplida(s) · {totalSinMotivo} sin motivo · {grupos.length} orden(es) ·{' '}
          {totalGruposSinMotivo} orden(es) con líneas sin motivo
        </span>
      </div>

      {mensaje && <p>{mensaje}</p>}
      {cargando && <p className="indicador-actualizando">Cargando...</p>}

      <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
        <table>
          <thead>
            <tr>
              {COLUMNAS_GRUPO.map((c) => (
                <ThOrdenable
                  key={c.clave}
                  clave={c.clave}
                  etiqueta={c.etiqueta}
                  orden={orden}
                  alOrdenar={alOrdenar}
                  ancho={anchos[c.clave] || c.anchoInicial}
                  alRedimensionar={alRedimensionar}
                />
              ))}
              <th style={{ width: 260 }}>Asignar motivo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {gruposVisibles.map((g) => {
              const clave = `${g.co}||${g.proveedor}||${g.nro_orden}`;
              return (
                <>
                  <tr key={clave} className={g.sinMotivo > 0 ? 'celda-roja-metal' : ''}>
                    <td>{g.co}</td>
                    <td>{g.proveedor}</td>
                    <td>{g.nro_orden}</td>
                    <td>{g.lineasCount}</td>
                    <td>{moneda(g.valorSolicitado)}</td>
                    <td>{g.fechaOrden || '-'}</td>
                    <td>{textoFechaEntrega(g)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <select
                          value={motivoPorGrupo[clave] || ''}
                          onChange={(e) => setMotivoPorGrupo((prev) => ({ ...prev, [clave]: e.target.value }))}
                        >
                          <option value="">Motivo...</option>
                          {motivos.map((m) => (
                            <option key={m.id} value={m.id}>{m.nombre}</option>
                          ))}
                        </select>
                        <button
                          disabled={!motivoPorGrupo[clave] || aplicando === clave}
                          onClick={() => asignarMotivoGrupo(g)}
                        >
                          {aplicando === clave ? 'Aplicando...' : 'Aplicar a todas'}
                        </button>
                      </div>
                    </td>
                    <td>
                      <button onClick={() => setExpandido(expandido === clave ? null : clave)}>
                        {expandido === clave ? 'Ocultar líneas' : 'Ver líneas'}
                      </button>
                    </td>
                  </tr>
                  {expandido === clave && (
                    <tr key={`${clave}-detalle`}>
                      <td colSpan={9} style={{ padding: 0 }}>
                        <table style={{ width: '100%', margin: '4px 0 10px' }}>
                          <thead>
                            <tr>
                              <th>Referencia</th>
                              <th>Desc. item</th>
                              <th>Fecha orden</th>
                              <th>Fecha entrega real</th>
                              <th>Diferencia</th>
                              <th>Valor bruto</th>
                              <th>Valor pendiente</th>
                              <th>Motivo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.lineas.map((l) => (
                              <tr key={l.id}>
                                <td>{l.referencia}</td>
                                <td>{l.desc_item}</td>
                                <td>{l.fecha_orden}</td>
                                <td>{l.fecha_entrega_real || '-'}</td>
                                <td>{l.diferencia ?? '-'}</td>
                                <td>{moneda(l.valor_bruto)}</td>
                                <td>{moneda(l.v_pendiente)}</td>
                                <td>{l.motivo_nombre || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {gruposVisibles.length === 0 && !cargando && (
              <tr><td colSpan={9} style={{ textAlign: 'center', opacity: 0.7 }}>
                {soloSinMotivoVista ? 'No hay órdenes con líneas sin motivo.' : 'Sin líneas incumplidas en el rango seleccionado.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
