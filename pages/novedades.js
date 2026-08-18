import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
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
  const [aplicando, setAplicando] = useState(null);

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

  // Agrupa por C.O. + Proveedor (no por ítem, que es demasiado dispendioso
  // de revisar uno por uno) -- así se puede asignar un motivo a todas las
  // líneas incumplidas de un proveedor en un solo clic.
  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const f of filas) {
      const clave = `${f.co}||${f.proveedor}`;
      if (!mapa.has(clave)) {
        mapa.set(clave, { co: f.co, proveedor: f.proveedor, lineas: [], valorPendiente: 0, sinMotivo: 0 });
      }
      const g = mapa.get(clave);
      g.lineas.push(f);
      g.valorPendiente += Number(f.v_pendiente || 0);
      if (!f.motivo_id) g.sinMotivo++;
    }
    return [...mapa.values()].sort((a, b) => b.lineas.length - a.lineas.length);
  }, [filas]);

  async function asignarMotivoGrupo(grupo) {
    const clave = `${grupo.co}||${grupo.proveedor}`;
    const motivoId = motivoPorGrupo[clave];
    const motivo = motivos.find((m) => String(m.id) === String(motivoId));
    if (!motivo) return;

    const idsObjetivo = (soloSinMotivo ? grupo.lineas.filter((l) => !l.motivo_id) : grupo.lineas).map((l) => l.id);
    if (idsObjetivo.length === 0) {
      setMensaje(`"${grupo.proveedor}" no tiene líneas pendientes de motivo.`);
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
      setMensaje(`Motivo "${motivo.nombre}" asignado a ${idsObjetivo.length} línea(s) de "${grupo.proveedor}".`);
      cargarFilas();
    }
  }

  const totalLineas = filas.length;
  const totalSinMotivo = filas.filter((f) => !f.motivo_id).length;

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="novedades">
      <h2>Novedades por incumplimiento en tiempo de entrega</h2>
      <p style={{ opacity: 0.8, maxWidth: 760 }}>
        Agrupado por proveedor (no por ítem, que es demasiado dispendioso de revisar uno a
        uno): asigna un motivo de incumplimiento a TODAS las líneas incumplidas de un
        proveedor de una sola vez, en vez de tener que ir línea por línea en Nivel de
        servicio. Esta pantalla es solo para el motivo de <b>incumplimiento en tiempo de
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
        <button style={{ marginTop: 16 }} onClick={cargarFilas} disabled={cargando}>
          {cargando ? 'Actualizando...' : 'Actualizar'}
        </button>
        <span style={{ marginTop: 16, fontSize: 12, opacity: 0.75 }}>
          {totalLineas} línea(s) incumplida(s) · {totalSinMotivo} sin motivo · {grupos.length} proveedor(es)
        </span>
      </div>

      {mensaje && <p>{mensaje}</p>}
      {cargando && <p className="indicador-actualizando">Cargando...</p>}

      <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
        <table>
          <thead>
            <tr>
              <th>C.O.</th>
              <th>Proveedor</th>
              <th>Líneas incumplidas</th>
              <th>Sin motivo</th>
              <th>Valor pendiente</th>
              <th style={{ width: 260 }}>Asignar motivo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => {
              const clave = `${g.co}||${g.proveedor}`;
              return (
                <>
                  <tr key={clave} className={g.sinMotivo > 0 ? 'celda-roja-metal' : ''}>
                    <td>{g.co}</td>
                    <td>{g.proveedor}</td>
                    <td>{g.lineas.length}</td>
                    <td>{g.sinMotivo}</td>
                    <td>{moneda(g.valorPendiente)}</td>
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
                      <td colSpan={7} style={{ padding: 0 }}>
                        <table style={{ width: '100%', margin: '4px 0 10px' }}>
                          <thead>
                            <tr>
                              <th>Nro orden</th>
                              <th>Referencia</th>
                              <th>Desc. item</th>
                              <th>Fecha orden</th>
                              <th>Fecha entrega real</th>
                              <th>Diferencia</th>
                              <th>Valor pendiente</th>
                              <th>Motivo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.lineas.map((l) => (
                              <tr key={l.id}>
                                <td>{l.nro_orden}</td>
                                <td>{l.referencia}</td>
                                <td>{l.desc_item}</td>
                                <td>{l.fecha_orden}</td>
                                <td>{l.fecha_entrega_real || '-'}</td>
                                <td>{l.diferencia ?? '-'}</td>
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
            {grupos.length === 0 && !cargando && (
              <tr><td colSpan={7} style={{ textAlign: 'center', opacity: 0.7 }}>Sin líneas incumplidas en el rango seleccionado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
