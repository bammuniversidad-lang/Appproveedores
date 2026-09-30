import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
  { clave: 'co', etiqueta: 'C.O.', anchoInicial: 70, filtrable: true },
  { clave: 'proveedor', etiqueta: 'Proveedor', anchoInicial: 220, filtrable: true },
  { clave: 'nro_orden', etiqueta: 'Nro documento', anchoInicial: 130, filtrable: true },
  { clave: 'lineasCount', etiqueta: 'Líneas incumplidas', anchoInicial: 130 },
  { clave: 'valorSolicitado', etiqueta: 'Valor solicitado', anchoInicial: 140 },
  { clave: 'fechaOrden', etiqueta: 'Fecha de la orden', anchoInicial: 130 },
  { clave: 'fechaEntregaMax', etiqueta: 'Fecha entrega real', anchoInicial: 150 },
  { clave: 'motivoTexto', etiqueta: 'Motivo asignado', anchoInicial: 190 },
];

// Cuántos identificadores se mandan por consulta al actualizar. No es un
// capricho: la lista de ids viaja en la URL, y con miles de líneas (asignar
// un motivo a varios documentos de golpe puede tocar cientos o miles) la
// petición se pasa de largo y el servidor la rechaza.
const LOTE_IDS = 400;

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
  // Una sola casilla gobierna las dos caras de "trabajar solo lo pendiente":
  // oculta de la lista los documentos ya resueltos Y, al aplicar un motivo,
  // no sobrescribe las líneas que ya tenían uno. Antes eran dos controles
  // separados (una casilla que solo afectaba la escritura y un botón que
  // solo afectaba la vista), y era confuso: se marcaba la casilla y la lista
  // seguía mostrando todo.
  const [soloSinMotivo, setSoloSinMotivo] = useState(true);
  const [aplicando, setAplicando] = useState(null);
  const [orden, setOrden] = useState(null);
  const [anchos, setAnchos] = useState({});
  const [filtros, setFiltros] = useState({ co: '', proveedor: '', nro_orden: '' });
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [motivoMasivo, setMotivoMasivo] = useState('');
  const [aplicandoMasivo, setAplicandoMasivo] = useState(false);
  const ordenarFilas = useOrdenTabla();
  const filaEncabezadoRef = useRef(null);
  const [altoEncabezado, setAltoEncabezado] = useState(30);

  function alOrdenar(clave) {
    setOrden((prev) => {
      if (prev?.clave === clave) return { clave, direccion: prev.direccion === 'asc' ? 'desc' : 'asc' };
      return { clave, direccion: 'asc' };
    });
  }

  function alRedimensionar(clave, ancho) {
    setAnchos((prev) => ({ ...prev, [clave]: ancho }));
  }

  function cambiarFiltro(clave, valor) {
    setFiltros((prev) => ({ ...prev, [clave]: valor }));
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
        // Igual que en Nivel de servicio: el rango filtra por "Fecha
        // cumplido" (la fecha en que el ERP marca la orden como
        // cumplida), no por "Fecha orden" -- usando "fecha_referencia"
        // (cae de vuelta a fecha_orden en las líneas que aún no tienen
        // fecha_cumplido cargada, para que no desaparezcan del rango).
        if (fechaInicio) q = q.gte('fecha_referencia', fechaInicio);
        if (fechaFin) q = q.lte('fecha_referencia', fechaFin);
        // ".order('id')" al final: sin un orden ÚNICO, la descarga por
        // páginas de 1000 puede repetir o perder filas en los empates de la
        // frontera (C.O. + Proveedor se repite en muchísimas líneas).
        return q.order('co').order('proveedor').order('id');
      });
      // Garantía extra contra filas repetidas entre páginas: el "id" se usa
      // para agrupar y para actualizar, así que una repetición desajusta los
      // conteos.
      const porId = new Map();
      for (const fila of datos) porId.set(fila.id, fila);
      setFilas([...porId.values()]);
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

  useEffect(() => {
    if (filaEncabezadoRef.current) setAltoEncabezado(filaEncabezadoRef.current.offsetHeight);
  }, [anchos]);

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
          clave,
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
          motivosIds: new Set(),
          motivosNombres: new Set(),
        });
      }
      const g = mapa.get(clave);
      g.lineas.push(f);
      g.lineasCount++;
      g.valorSolicitado += Number(f.valor_bruto || 0);
      if (!f.motivo_id) g.sinMotivo++;
      else {
        g.motivosIds.add(String(f.motivo_id));
        g.motivosNombres.add(f.motivo_nombre || `Motivo ${f.motivo_id}`);
      }
      if (f.fecha_orden && (!g.fechaOrden || f.fecha_orden < g.fechaOrden)) g.fechaOrden = f.fecha_orden;
      if (f.fecha_entrega_real) {
        if (!g.fechaEntregaMin || f.fecha_entrega_real < g.fechaEntregaMin) g.fechaEntregaMin = f.fecha_entrega_real;
        if (!g.fechaEntregaMax || f.fecha_entrega_real > g.fechaEntregaMax) g.fechaEntregaMax = f.fecha_entrega_real;
      }
    }

    // Resumen del motivo YA GUARDADO en cada documento. Antes el documento
    // no mostraba nada del motivo asignado (solo la lista desplegable, que
    // arranca vacía), así que después de aplicar un motivo la fila se veía
    // igual que antes y quedaba la duda de si se había guardado o no.
    for (const g of mapa.values()) {
      const nombres = [...g.motivosNombres].sort();
      if (nombres.length === 0) g.motivoTexto = 'Sin motivo';
      else if (nombres.length === 1) {
        g.motivoTexto = g.sinMotivo === 0 ? nombres[0] : `${nombres[0]} · faltan ${g.sinMotivo}`;
      } else {
        g.motivoTexto = `Varios (${nombres.join(', ')})${g.sinMotivo > 0 ? ` · faltan ${g.sinMotivo}` : ''}`;
      }
      // Si TODAS las líneas comparten el mismo motivo, ese es el valor que
      // debe aparecer preseleccionado en la lista desplegable del documento.
      g.motivoUnicoId = g.sinMotivo === 0 && g.motivosIds.size === 1 ? [...g.motivosIds][0] : '';
    }
    return [...mapa.values()];
  }, [filas]);

  const gruposVisibles = useMemo(() => {
    let base = soloSinMotivo ? grupos.filter((g) => g.sinMotivo > 0) : grupos;
    for (const [clave, valor] of Object.entries(filtros)) {
      const v = valor.trim().toLowerCase();
      if (!v) continue;
      base = base.filter((g) => String(g[clave] ?? '').toLowerCase().includes(v));
    }
    return ordenarFilas(base, orden || { clave: 'lineasCount', direccion: 'desc' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, orden, soloSinMotivo, filtros]);

  function textoFechaEntrega(g) {
    if (!g.fechaEntregaMax) return '-';
    if (g.fechaEntregaMin === g.fechaEntregaMax) return g.fechaEntregaMax;
    return `${g.fechaEntregaMin} a ${g.fechaEntregaMax}`;
  }

  function alternarSeleccion(clave) {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(clave)) nuevo.delete(clave);
      else nuevo.add(clave);
      return nuevo;
    });
  }

  function alternarSeleccionarTodoVisible() {
    const claves = gruposVisibles.map((g) => g.clave);
    const todosYa = claves.length > 0 && claves.every((c) => seleccionados.has(c));
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      claves.forEach((c) => (todosYa ? nuevo.delete(c) : nuevo.add(c)));
      return nuevo;
    });
  }

  // Asigna un motivo a uno o varios documentos. Es la misma función para el
  // botón de una fila y para la aplicación masiva a la selección: se juntan
  // todas las líneas objetivo y se actualizan por lotes.
  async function asignarMotivoAGrupos(gruposObjetivo, motivoId) {
    const motivo = motivos.find((m) => String(m.id) === String(motivoId));
    if (!motivo || gruposObjetivo.length === 0) return;

    const ids = [];
    for (const g of gruposObjetivo) {
      const lineas = soloSinMotivo ? g.lineas.filter((l) => !l.motivo_id) : g.lineas;
      for (const l of lineas) ids.push(l.id);
    }
    if (ids.length === 0) {
      setMensaje(
        gruposObjetivo.length === 1
          ? `La orden "${gruposObjetivo[0].nro_orden}" de "${gruposObjetivo[0].proveedor}" no tiene líneas pendientes de motivo.`
          : 'Los documentos seleccionados no tienen líneas pendientes de motivo.'
      );
      return false;
    }

    const campos = {
      motivo_id: motivo.id,
      responsable_motivo: motivo.responsable,
      motivo_asignado_en: new Date().toISOString(),
      motivo_asignado_por: session?.user?.id,
    };

    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      const { error } = await supabase
        .from('pedidos_detalle')
        .update(campos)
        .in('id', ids.slice(i, i + LOTE_IDS));
      if (error) {
        setMensaje(`Error asignando motivo: ${error.message}`);
        cargarFilas();
        return false;
      }
    }

    setMensaje(
      `Motivo "${motivo.nombre}" asignado a ${ids.length} línea(s) en ${gruposObjetivo.length} documento(s).`
    );
    cargarFilas();
    return true;
  }

  async function asignarMotivoGrupo(grupo) {
    const motivoId = motivoPorGrupo[grupo.clave] || grupo.motivoUnicoId;
    if (!motivoId) return;
    setAplicando(grupo.clave);
    await asignarMotivoAGrupos([grupo], motivoId);
    setAplicando(null);
  }

  async function asignarMotivoSeleccion() {
    if (!motivoMasivo || seleccionados.size === 0) return;
    // Se toman de "grupos" y no de "gruposVisibles": si marcaste documentos
    // y después escribiste algo en un filtro, los que marcaste siguen
    // contando -- no se pierden silenciosamente por quedar fuera de la vista.
    const objetivo = grupos.filter((g) => seleccionados.has(g.clave));
    setAplicandoMasivo(true);
    const ok = await asignarMotivoAGrupos(objetivo, motivoMasivo);
    setAplicandoMasivo(false);
    if (ok) {
      setSeleccionados(new Set());
      setMotivoMasivo('');
    }
  }

  const totalLineas = filas.length;
  const totalSinMotivo = filas.filter((f) => !f.motivo_id).length;
  const totalGruposSinMotivo = grupos.filter((g) => g.sinMotivo > 0).length;
  const todosVisiblesSeleccionados =
    gruposVisibles.length > 0 && gruposVisibles.every((g) => seleccionados.has(g.clave));
  const columnasTotales = COLUMNAS_GRUPO.length + 3; // casilla + asignar + ver líneas

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="novedades">
      <h2>Novedades por incumplimiento en tiempo de entrega</h2>
      <p style={{ opacity: 0.8, maxWidth: 760 }}>
        Agrupado por C.O. + Proveedor + Nro documento (no por ítem, que es demasiado
        dispendioso de revisar uno a uno): asigna un motivo de incumplimiento a TODAS las
        líneas incumplidas de una orden de una sola vez. Puedes marcar varios documentos
        con las casillas de la izquierda y aplicarles el mismo motivo de golpe, filtrar por
        C.O., proveedor o documento en los campos debajo de cada título, y hacer clic en los
        títulos para ordenar. Esta pantalla es solo para el motivo de <b>incumplimiento en
        tiempo de entrega</b>. Para el motivo de <b>faltante de ítem</b> (cantidad
        pendiente), ve a Nivel de servicio.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <label>Desde (fecha cumplido)</label><br />
          <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
        </div>
        <div>
          <label>Hasta (fecha cumplido)</label><br />
          <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
        </div>
        <label style={{ marginTop: 16 }} title="Oculta los documentos que ya quedaron completos y, al aplicar un motivo, no sobrescribe las líneas que ya tenían uno.">
          <input type="checkbox" checked={soloSinMotivo} onChange={(e) => setSoloSinMotivo(e.target.checked)} />
          {' '}Trabajar solo lo que no tiene motivo ({totalGruposSinMotivo} documento(s))
        </label>
        <button style={{ marginTop: 16 }} onClick={cargarFilas} disabled={cargando}>
          {cargando ? 'Actualizando...' : 'Actualizar'}
        </button>
        <span style={{ marginTop: 16, fontSize: 12, opacity: 0.75 }}>
          {totalLineas} línea(s) incumplida(s) · {totalSinMotivo} sin motivo · {grupos.length} orden(es) ·{' '}
          {gruposVisibles.length} visible(s)
        </span>
      </div>

      {seleccionados.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <span>{seleccionados.size} documento(s) seleccionado(s)</span>
          <select value={motivoMasivo} onChange={(e) => setMotivoMasivo(e.target.value)}>
            <option value="">Asignar motivo a la selección...</option>
            {motivos.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
          <button disabled={!motivoMasivo || aplicandoMasivo} onClick={asignarMotivoSeleccion}>
            {aplicandoMasivo ? 'Aplicando...' : `Aplicar a ${seleccionados.size} documento(s)`}
          </button>
          <button onClick={() => setSeleccionados(new Set())}>Quitar selección</button>
        </div>
      )}

      {mensaje && <p>{mensaje}</p>}
      {cargando && <p className="indicador-actualizando">Cargando...</p>}

      <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
        <table>
          <thead>
            <tr ref={filaEncabezadoRef}>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={todosVisiblesSeleccionados}
                  onChange={alternarSeleccionarTodoVisible}
                  title="Seleccionar todos los documentos visibles"
                />
              </th>
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
            <tr className="fila-filtros-columna">
              <td style={{ top: altoEncabezado }}></td>
              {COLUMNAS_GRUPO.map((c) => (
                <td key={c.clave} style={{ top: altoEncabezado }}>
                  {c.filtrable && (
                    <input
                      type="text"
                      placeholder={`Filtrar ${c.etiqueta.toLowerCase()}...`}
                      value={filtros[c.clave]}
                      onChange={(e) => cambiarFiltro(c.clave, e.target.value)}
                    />
                  )}
                </td>
              ))}
              <td style={{ top: altoEncabezado }}></td>
              <td style={{ top: altoEncabezado }}></td>
            </tr>
          </thead>
          <tbody>
            {gruposVisibles.map((g) => {
              const clave = g.clave;
              const seleccionMotivo = motivoPorGrupo[clave] ?? g.motivoUnicoId;
              return (
                <Fragment key={clave}>
                  <tr className={g.sinMotivo > 0 ? 'celda-roja-metal' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={seleccionados.has(clave)}
                        onChange={() => alternarSeleccion(clave)}
                      />
                    </td>
                    <td>{g.co}</td>
                    <td>{g.proveedor}</td>
                    <td>{g.nro_orden}</td>
                    <td>{g.lineasCount}</td>
                    <td>{moneda(g.valorSolicitado)}</td>
                    <td>{g.fechaOrden || '-'}</td>
                    <td>{textoFechaEntrega(g)}</td>
                    <td title={g.motivoTexto}>{g.motivoTexto}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <select
                          value={seleccionMotivo}
                          onChange={(e) => setMotivoPorGrupo((prev) => ({ ...prev, [clave]: e.target.value }))}
                        >
                          <option value="">Motivo...</option>
                          {motivos.map((m) => (
                            <option key={m.id} value={m.id}>{m.nombre}</option>
                          ))}
                        </select>
                        <button
                          disabled={!seleccionMotivo || aplicando === clave || (soloSinMotivo && g.sinMotivo === 0)}
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
                    <tr>
                      <td colSpan={columnasTotales} style={{ padding: 0 }}>
                        <table style={{ width: '100%', margin: '4px 0 10px' }}>
                          <thead>
                            <tr>
                              <th>Referencia</th>
                              <th>Desc. item</th>
                              <th>Cant. ordenada</th>
                              <th>Fecha orden</th>
                              <th>Fecha entrega real</th>
                              <th>Tiempo de entrega (días)</th>
                              <th>Diferencia (días de entrega)</th>
                              <th>Valor bruto</th>
                              <th>Motivo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.lineas.map((l) => (
                              <tr key={l.id}>
                                <td>{l.referencia}</td>
                                <td>{l.desc_item}</td>
                                <td>{Number(l.cant_ordenada ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })}</td>
                                <td>{l.fecha_orden}</td>
                                <td>{l.fecha_entrega_real || '-'}</td>
                                <td>{l.dias_entrega_esperados ?? '-'}</td>
                                <td>{l.diferencia ?? '-'}</td>
                                <td>{moneda(l.valor_bruto)}</td>
                                <td>{l.motivo_nombre || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {gruposVisibles.length === 0 && !cargando && (
              <tr><td colSpan={columnasTotales} style={{ textAlign: 'center', opacity: 0.7 }}>
                {soloSinMotivo
                  ? 'No hay documentos con líneas sin motivo (desmarca "Trabajar solo lo que no tiene motivo" para ver los ya asignados).'
                  : 'Sin líneas incumplidas en el rango seleccionado.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
