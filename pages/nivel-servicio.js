import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import Layout from '../components/Layout';
import { ThOrdenable, useOrdenTabla } from '../components/TablaHeader';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { primerDiaMesActual, hoyISO } from '../lib/fechas';

const COLUMNAS_CON_FILTRO = ['referencia', 'proveedor', 'nro_orden', 'desc_item'];

const COLUMNAS = [
  { clave: 'co', etiqueta: 'C.O.' },
  { clave: 'nro_orden', etiqueta: 'Nro orden' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'referencia', etiqueta: 'Referencia' },
  { clave: 'desc_item', etiqueta: 'Desc. item' },
  { clave: 'fecha_orden', etiqueta: 'Fecha orden' },
  { clave: 'fecha_orden_original', etiqueta: 'Fecha orden original' },
  { clave: 'fecha_entrega_real', etiqueta: 'Fecha entrega real' },
  { clave: 'cant_ordenada', etiqueta: 'Cant. ordenada', tipo: 'numero' },
  { clave: 'cant_entrada_inv', etiqueta: 'Cant. entrada inv.', tipo: 'numero' },
  { clave: 'cant_pendiente_inv', etiqueta: 'Cant. pendiente', tipo: 'numero' },
  { clave: 'docto_referencia', etiqueta: 'Docto. referencia' },
  { clave: 'v_pendiente', etiqueta: 'Valor pendiente', tipo: 'moneda' },
  { clave: 'observaciones', etiqueta: 'Observaciones' },
  { clave: 'observacion2', etiqueta: 'Cumplimiento' },
  { clave: 'motivo_nombre', etiqueta: 'Motivo (incumplimiento)' },
  { clave: 'motivo_faltante_nombre', etiqueta: 'Motivo (faltante)' },
];

// Mismo patrón que en Compras (es-CO): moneda sin decimales, cantidades
// con separador de miles.
function formatearCelda(valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return '-';
  if (tipo === 'moneda') return `$ ${Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
  if (tipo === 'numero') return Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  return valor;
}

function claseFilaRevision(fila) {
  if (fila.necesita_revision) return 'celda-roja-metal';
  if (fila.fecha_orden_corregida) return 'celda-amarilla-metal';
  return '';
}

export default function NivelServicio({ tema, alternarTema }) {
  const { session } = useAuth();
  const [filas, setFilas] = useState([]);
  const [motivos, setMotivos] = useState([]);
  const [tarjetas, setTarjetas] = useState(null);
  const [fechaInicio, setFechaInicio] = useState(primerDiaMesActual());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [soloPorRevisar, setSoloPorRevisar] = useState(false);
  const [soloIncumplido, setSoloIncumplido] = useState(false);
  const [soloConPendiente, setSoloConPendiente] = useState(false);
  const [co, setCo] = useState('');
  const [cosDisponibles, setCosDisponibles] = useState([]);
  const [columnasOcultas, setColumnasOcultas] = useState([]);
  const [filtrosColumna, setFiltrosColumna] = useState({ referencia: '', proveedor: '', nro_orden: '', desc_item: '' });
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [motivoMasivo, setMotivoMasivo] = useState('');
  const [motivoFaltanteMasivo, setMotivoFaltanteMasivo] = useState('');
  const [fechaMasiva, setFechaMasiva] = useState('');
  const [corrigiendoMasivo, setCorrigiendoMasivo] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [anchos, setAnchos] = useState({});
  const [orden, setOrden] = useState(null);
  const ordenarFilas = useOrdenTabla();
  const filaEncabezadoRef = useRef(null);
  const [altoEncabezado, setAltoEncabezado] = useState(30);

  function alRedimensionar(clave, ancho) {
    setAnchos((prev) => ({ ...prev, [clave]: ancho }));
  }

  function alOrdenar(clave) {
    setOrden((prev) => {
      if (prev?.clave === clave) return { clave, direccion: prev.direccion === 'asc' ? 'desc' : 'asc' };
      return { clave, direccion: 'asc' };
    });
  }

  function alternarColumna(clave) {
    setColumnasOcultas((prev) => (
      prev.includes(clave) ? prev.filter((c) => c !== clave) : [...prev, clave]
    ));
  }

  function cambiarFiltroColumna(clave, valor) {
    setFiltrosColumna((prev) => ({ ...prev, [clave]: valor }));
  }

  async function cargarMotivos() {
    const { data } = await supabase.from('motivos').select('*').order('nombre');
    setMotivos(data || []);
  }

  async function cargarCOs() {
    const { data } = await supabase.from('pedidos_detalle').select('co');
    setCosDisponibles([...new Set((data || []).map((r) => r.co).filter(Boolean))].sort());
  }

  // Arma una consulta NUEVA cada vez (no se puede reutilizar el mismo query
  // builder para varias páginas).
  function construirConsultaFilas() {
    let consulta = supabase.from('v_ns_proveedores').select('*');
    if (fechaInicio) consulta = consulta.gte('fecha_orden', fechaInicio);
    if (fechaFin) consulta = consulta.lte('fecha_orden', fechaFin);
    if (soloPorRevisar) consulta = consulta.eq('necesita_revision', true);
    if (soloIncumplido) consulta = consulta.eq('observacion2', 'INCUMPLIDO');
    if (soloConPendiente) consulta = consulta.gt('cant_pendiente_inv', 0);
    if (co) consulta = consulta.eq('co', co);
    return consulta.order('co', { ascending: true }).order('nro_orden', { ascending: true });
  }

  // Supabase/PostgREST solo devuelve 1000 filas por consulta por defecto.
  // Si no se pagina, la tabla (y por lo tanto el Excel descargado) se corta
  // en 1000 líneas y los totales no cuadran con el Dashboard, que sí calcula
  // sobre TODAS las filas dentro de la base de datos. Aquí se pide página
  // por página hasta traer todo.
  async function cargarFilas() {
    setCargando(true);
    const TAMANO_PAGINA = 1000;
    let desde = 0;
    let todas = [];
    let errorFinal = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await construirConsultaFilas().range(desde, desde + TAMANO_PAGINA - 1);
      if (error) {
        errorFinal = error;
        break;
      }
      todas = todas.concat(data || []);
      if (!data || data.length < TAMANO_PAGINA) break;
      desde += TAMANO_PAGINA;
    }
    if (errorFinal) {
      setMensaje(`Error cargando datos: ${errorFinal.message}`);
      setFilas([]);
    } else {
      setFilas(todas);
    }
    setCargando(false);
  }

  async function cargarTarjetas() {
    const { data, error } = await supabase.rpc('get_ns_proveedores_cards', {
      co_list: co ? [co] : null,
      fecha_inicio: fechaInicio || null,
      fecha_fin: fechaFin || null,
    });
    if (!error) setTarjetas(data?.[0] || null);
  }

  useEffect(() => {
    cargarMotivos();
    cargarCOs();
  }, []);

  useEffect(() => {
    cargarFilas();
    cargarTarjetas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaInicio, fechaFin, soloPorRevisar, soloIncumplido, soloConPendiente, co]);

  useEffect(() => {
    if (filaEncabezadoRef.current) {
      setAltoEncabezado(filaEncabezadoRef.current.offsetHeight);
    }
  }, [columnasOcultas]);

  async function corregirFechas() {
    setCorrigiendo(true);
    setMensaje('');
    const { data, error } = await supabase.rpc('corregir_fechas_orden_ns_proveedores');
    setCorrigiendo(false);
    if (error) {
      setMensaje(`Error al corregir fechas: ${error.message}`);
      return;
    }
    const r = data?.[0];
    setMensaje(
      r
        ? `Evaluadas: ${r.filas_evaluadas} · Corregidas automáticamente: ${r.filas_corregidas} · Pendientes de revisión: ${r.filas_pendientes_revision}`
        : 'Corrección ejecutada.'
    );
    cargarFilas();
    cargarTarjetas();
  }

  function alternarSeleccion(id) {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  function alternarSeleccionarTodoVisible() {
    const idsVisibles = filasOrdenadas.map((f) => f.id);
    const todosVisiblesYaSeleccionados = idsVisibles.length > 0 && idsVisibles.every((id) => seleccionados.has(id));
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      idsVisibles.forEach((id) => {
        if (todosVisiblesYaSeleccionados) nuevo.delete(id);
        else nuevo.add(id);
      });
      return nuevo;
    });
  }

  // tipo='incumplimiento' -> motivo_id (columna "Cumplimiento" = INCUMPLIDO).
  // tipo='faltante' -> motivo_faltante_id (cant_pendiente_inv > 0). Son dos
  // clasificaciones independientes -- una línea puede tener cantidad
  // pendiente sin haber incumplido el tiempo de entrega, o viceversa.
  async function asignarMotivo(ids, motivoId, tipo = 'incumplimiento') {
    const motivo = motivos.find((m) => String(m.id) === String(motivoId));
    if (!motivo) return;
    const campos = tipo === 'faltante'
      ? {
          motivo_faltante_id: motivo.id,
          responsable_motivo_faltante: motivo.responsable,
          motivo_faltante_asignado_en: new Date().toISOString(),
          motivo_faltante_asignado_por: session?.user?.id,
        }
      : {
          motivo_id: motivo.id,
          responsable_motivo: motivo.responsable,
          motivo_asignado_en: new Date().toISOString(),
          motivo_asignado_por: session?.user?.id,
        };
    const { error } = await supabase
      .from('pedidos_detalle')
      .update(campos)
      .in('id', ids);

    if (error) {
      setMensaje(`Error asignando motivo: ${error.message}`);
    } else {
      setMensaje(tipo === 'faltante' ? 'Motivo de faltante asignado correctamente.' : 'Motivo asignado correctamente.');
      setSeleccionados(new Set());
      cargarFilas();
    }
  }

  // Permite editar manualmente "Fecha orden" en las líneas que quedaron
  // marcadas para revisión (el sistema no pudo resolverlas solo).
  async function corregirManualmente(fila, nuevaFecha) {
    if (!nuevaFecha) return;
    const { error } = await supabase
      .from('pedidos_detalle')
      .update({
        fecha_orden_original: fila.fecha_orden_original || fila.fecha_orden,
        fecha_orden: nuevaFecha,
        fecha_orden_corregida: true,
        fecha_orden_corregida_en: new Date().toISOString(),
        necesita_revision: false,
      })
      .eq('id', fila.id);
    if (error) {
      setMensaje(`Error guardando la fecha: ${error.message}`);
    } else {
      cargarFilas();
      cargarTarjetas();
    }
  }

  // Igual que corregirManualmente, pero aplicada a TODAS las filas
  // seleccionadas de una sola vez (ej.: filtrar por Nro orden, seleccionar
  // todo con la casilla del encabezado, y aplicar una sola fecha). Cada fila
  // conserva su propia "fecha_orden_original" (no se sobrescribe si ya
  // existe), así que se actualiza una por una en vez de un solo UPDATE
  // masivo con un valor fijo.
  async function corregirFechaMasivo(filasObjetivo, nuevaFecha) {
    if (!nuevaFecha || filasObjetivo.length === 0) return;
    setCorrigiendoMasivo(true);
    setMensaje('');
    const resultados = await Promise.all(
      filasObjetivo.map((fila) =>
        supabase
          .from('pedidos_detalle')
          .update({
            fecha_orden_original: fila.fecha_orden_original || fila.fecha_orden,
            fecha_orden: nuevaFecha,
            fecha_orden_corregida: true,
            fecha_orden_corregida_en: new Date().toISOString(),
            necesita_revision: false,
          })
          .eq('id', fila.id)
      )
    );
    setCorrigiendoMasivo(false);
    const errores = resultados.filter((r) => r.error);
    if (errores.length > 0) {
      setMensaje(`Se aplicó la fecha a ${filasObjetivo.length - errores.length} de ${filasObjetivo.length} línea(s). Errores: ${errores[0].error.message}`);
    } else {
      setMensaje(`Fecha de orden ${nuevaFecha} aplicada a ${filasObjetivo.length} línea(s).`);
      setFechaMasiva('');
      setSeleccionados(new Set());
    }
    cargarFilas();
    cargarTarjetas();
  }

  function exportar() {
    const datos = filasOrdenadas.map((f) => ({
      'C.O.': f.co,
      'Nro orden': f.nro_orden,
      Proveedor: f.proveedor,
      Referencia: f.referencia,
      'Desc. item': f.desc_item,
      'Fecha orden': f.fecha_orden,
      'Fecha orden original': f.fecha_orden_original,
      'Corregida automáticamente': f.fecha_orden_corregida ? 'Sí' : 'No',
      'Necesita revisión': f.necesita_revision ? 'Sí' : 'No',
      'Fecha entrega real': f.fecha_entrega_real,
      'Cant. ordenada': f.cant_ordenada,
      'Cant. entrada inv.': f.cant_entrada_inv,
      'Cant. pendiente': f.cant_pendiente_inv,
      'Docto. referencia': f.docto_referencia,
      'Valor pendiente': f.v_pendiente,
      Observaciones: f.observaciones,
      Cumplimiento: f.observacion2,
      'Motivo (incumplimiento)': f.motivo_nombre,
      'Responsable (incumplimiento)': f.motivo_responsable,
      'Motivo (faltante)': f.motivo_faltante_nombre,
      'Responsable (faltante)': f.motivo_faltante_responsable,
    }));
    const hoja = XLSX.utils.json_to_sheet(datos);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Nivel de servicio');
    XLSX.writeFile(libro, `nivel_servicio_${fechaInicio || 'inicio'}_a_${fechaFin || 'hoy'}.xlsx`);
  }

  const columnasVisibles = useMemo(
    () => COLUMNAS.filter((c) => !columnasOcultas.includes(c.clave)),
    [columnasOcultas]
  );

  const filasOrdenadas = useMemo(() => {
    const ordenadas = ordenarFilas(filas, orden);
    const filtrosActivos = Object.entries(filtrosColumna).filter(([, v]) => v.trim() !== '');
    if (filtrosActivos.length === 0) return ordenadas;
    return ordenadas.filter((f) =>
      filtrosActivos.every(([clave, valor]) =>
        String(f[clave] ?? '').toLowerCase().includes(valor.trim().toLowerCase())
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, orden, filtrosColumna]);
  const todosVisiblesSeleccionados = filasOrdenadas.length > 0 && filasOrdenadas.every((f) => seleccionados.has(f.id));

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="nivel_servicio">
      <h2>Nivel de servicio</h2>

      {tarjetas && (
        <div className="tarjetas">
          <div className="tarjeta">
            <h3>Líneas</h3>
            <div className="fila"><span>Totales</span><b>{tarjetas.lineas_totales}</b></div>
            <div className="fila"><span>Cumplidas</span><b>{tarjetas.lineas_cumplidas}</b></div>
            <div className="fila"><span>Incumplidas</span><b>{tarjetas.lineas_incumplidas}</b></div>
            <div className="valor-grande-tarjeta">{(Number(tarjetas.ns_lineas) * 100).toFixed(1)}%</div>
          </div>
          <div className="tarjeta">
            <h3>Valor</h3>
            <div className="fila"><span>Total</span><b>{Number(tarjetas.valor_total).toLocaleString('es-CO')}</b></div>
            <div className="fila"><span>Pendiente</span><b>{Number(tarjetas.valor_pendiente).toLocaleString('es-CO')}</b></div>
            <div className="valor-grande-tarjeta">{(Number(tarjetas.ns_valor) * 100).toFixed(1)}%</div>
          </div>
          <div className="tarjeta">
            <h3>Fechas de orden</h3>
            <div className="fila"><span>Corregidas automáticamente</span><b>{tarjetas.lineas_corregidas_automaticamente}</b></div>
            <div className="fila"><span>Por revisar</span><b>{tarjetas.lineas_por_revisar}</b></div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <label>Desde</label><br />
          <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
        </div>
        <div>
          <label>Hasta</label><br />
          <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
        </div>
        <div>
          <label>C.O.</label><br />
          <select value={co} onChange={(e) => setCo(e.target.value)}>
            <option value="">Todos</option>
            {cosDisponibles.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <label style={{ marginTop: 16 }}>
          <input type="checkbox" checked={soloPorRevisar} onChange={(e) => setSoloPorRevisar(e.target.checked)} />
          {' '}Solo por revisar
        </label>
        <label style={{ marginTop: 16 }}>
          <input type="checkbox" checked={soloIncumplido} onChange={(e) => setSoloIncumplido(e.target.checked)} />
          {' '}Solo incumplidos (tiempo de entrega)
        </label>
        <label style={{ marginTop: 16 }}>
          <input type="checkbox" checked={soloConPendiente} onChange={(e) => setSoloConPendiente(e.target.checked)} />
          {' '}Solo con cantidad pendiente (faltante)
        </label>
        <button style={{ marginTop: 16 }} onClick={exportar}>Descargar Excel</button>
        <button style={{ marginTop: 16 }} onClick={corregirFechas} disabled={corrigiendo}>
          {corrigiendo ? 'Corrigiendo...' : 'Corregir fechas de orden'}
        </button>
        <button style={{ marginTop: 16 }} onClick={() => { cargarFilas(); cargarTarjetas(); }} disabled={cargando}>
          {cargando ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <details style={{ marginBottom: 10 }}>
        <summary>Mostrar/ocultar columnas</summary>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {COLUMNAS.map((c) => (
            <label key={c.clave} style={{ border: '1px solid #999', borderRadius: 3, padding: '2px 6px' }}>
              <input
                type="checkbox"
                checked={!columnasOcultas.includes(c.clave)}
                onChange={() => alternarColumna(c.clave)}
              />
              {' '}{c.etiqueta}
            </label>
          ))}
        </div>
      </details>

      <p style={{ fontSize: 11, opacity: 0.75, maxWidth: 760 }}>
        <span className="celda-amarilla-metal" style={{ padding: '1px 6px', borderRadius: 3 }}>Amarillo</span>
        {' '}= la fecha de orden se corrigió sola con el histórico de ODC. {' '}
        <span className="celda-roja-metal" style={{ padding: '1px 6px', borderRadius: 3 }}>Rojo</span>
        {' '}= sigue con la fecha de orden igual a la fecha de entrada y no se encontró (o no sirvió) el histórico de ODC — revísala y corrígela manualmente abajo.
      </p>

      <p style={{ fontSize: 11, opacity: 0.75, maxWidth: 760 }}>
        Hay <b>dos motivos independientes</b> por línea: "Motivo (incumplimiento)" es por
        qué se incumplió el <b>tiempo de entrega</b> (columna Cumplimiento = INCUMPLIDO), y
        "Motivo (faltante)" es por qué quedó <b>cantidad pendiente</b> del ítem (columna
        Observaciones = INCOMPLETA). Marca "Solo con cantidad pendiente (faltante)" arriba,
        selecciona todo con la casilla del encabezado y usa "Aplicar a selección" para
        cubrir el 100% del indicador de faltantes más rápido.
      </p>

      <p style={{ fontSize: 11, opacity: 0.75, maxWidth: 760 }}>
        Para corregir la <b>fecha de orden</b> de todo un Nro orden a la vez (en vez de
        línea a línea): escribe el Nro orden en el filtro de esa columna, marca la casilla
        del encabezado para seleccionar todas las líneas filtradas, elige la fecha en el
        control de abajo (junto a "Aplicar a selección") y presiona "Aplicar fecha de orden
        a selección".
      </p>

      <p style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>
        {filas.length} línea(s) cargada(s) para el rango de fechas {co ? `y C.O. ${co}` : ''}
        {filasOrdenadas.length !== filas.length && ` · ${filasOrdenadas.length} después de los filtros de columna`}.
      </p>

      {seleccionados.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <span>{seleccionados.size} fila(s) seleccionada(s)</span>
          <select value={motivoMasivo} onChange={(e) => setMotivoMasivo(e.target.value)}>
            <option value="">Asignar motivo (incumplimiento)...</option>
            {motivos.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
          <button disabled={!motivoMasivo} onClick={() => asignarMotivo([...seleccionados], motivoMasivo, 'incumplimiento')}>
            Aplicar a selección
          </button>
          <select value={motivoFaltanteMasivo} onChange={(e) => setMotivoFaltanteMasivo(e.target.value)}>
            <option value="">Asignar motivo (faltante)...</option>
            {motivos.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
          <button disabled={!motivoFaltanteMasivo} onClick={() => asignarMotivo([...seleccionados], motivoFaltanteMasivo, 'faltante')}>
            Aplicar a selección
          </button>
          <span style={{ opacity: 0.4 }}>|</span>
          <input
            type="date"
            value={fechaMasiva}
            onChange={(e) => setFechaMasiva(e.target.value)}
            title="Fecha de orden a aplicar a toda la selección"
          />
          <button
            disabled={!fechaMasiva || corrigiendoMasivo}
            onClick={() => corregirFechaMasivo(filasOrdenadas.filter((f) => seleccionados.has(f.id)), fechaMasiva)}
          >
            {corrigiendoMasivo ? 'Aplicando...' : 'Aplicar fecha de orden a selección'}
          </button>
        </div>
      )}

      {mensaje && <p>{mensaje}</p>}
      {cargando && <p className="indicador-actualizando">Actualizando...</p>}

      <div style={{ overflow: 'auto', maxHeight: '65vh' }}>
        <table>
          <thead>
            <tr ref={filaEncabezadoRef}>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={todosVisiblesSeleccionados} onChange={alternarSeleccionarTodoVisible} />
              </th>
              {columnasVisibles.map((c) => (
                <ThOrdenable
                  key={c.clave}
                  clave={c.clave}
                  etiqueta={c.etiqueta}
                  ancho={anchos[c.clave] || 140}
                  alRedimensionar={alRedimensionar}
                  orden={orden}
                  alOrdenar={alOrdenar}
                />
              ))}
              <th style={{ width: 160 }}>Motivo (incumplimiento)</th>
              <th style={{ width: 160 }}>Motivo (faltante)</th>
              <th style={{ width: 170 }}>Corregir manualmente</th>
            </tr>
            <tr className="fila-filtros-columna">
              <td style={{ top: altoEncabezado }}></td>
              {columnasVisibles.map((c) => (
                <td key={c.clave} style={{ top: altoEncabezado, width: anchos[c.clave] || 140 }}>
                  {COLUMNAS_CON_FILTRO.includes(c.clave) && (
                    <input
                      type="text"
                      placeholder={`Filtrar ${c.etiqueta.toLowerCase()}...`}
                      value={filtrosColumna[c.clave]}
                      onChange={(e) => cambiarFiltroColumna(c.clave, e.target.value)}
                      style={{ width: '100%' }}
                    />
                  )}
                </td>
              ))}
              <td style={{ top: altoEncabezado }}></td>
              <td style={{ top: altoEncabezado }}></td>
              <td style={{ top: altoEncabezado }}></td>
            </tr>
          </thead>
          <tbody>
            {filasOrdenadas.map((f) => (
              <tr key={f.id} className={claseFilaRevision(f)}>
                <td>
                  <input type="checkbox" checked={seleccionados.has(f.id)} onChange={() => alternarSeleccion(f.id)} />
                </td>
                {columnasVisibles.map((c) => (
                  <td key={c.clave} style={{ width: anchos[c.clave] || 140, maxWidth: anchos[c.clave] || 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatearCelda(f[c.clave], c.tipo)}
                  </td>
                ))}
                <td>
                  <select value={f.motivo_id || ''} onChange={(e) => asignarMotivo([f.id], e.target.value, 'incumplimiento')}>
                    <option value="">Sin motivo</option>
                    {motivos.map((m) => (
                      <option key={m.id} value={m.id}>{m.nombre}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={f.motivo_faltante_id || ''} onChange={(e) => asignarMotivo([f.id], e.target.value, 'faltante')}>
                    <option value="">Sin motivo</option>
                    {motivos.map((m) => (
                      <option key={m.id} value={m.id}>{m.nombre}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {f.necesita_revision && (
                    <input
                      type="date"
                      defaultValue=""
                      onChange={(e) => corregirManualmente(f, e.target.value)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
