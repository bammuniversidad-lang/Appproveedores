import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList,
} from 'recharts';
import Layout from '../components/Layout';
import CuadroDashboard, { colorPorNsValor, colorPorPorcentajePendiente } from '../components/CuadroDashboard';
import { supabase } from '../lib/supabaseClient';
import { primerDiaMesActual, hoyISO } from '../lib/fechas';
import { exportarDashboardExcel, exportarDashboardPowerPoint } from '../lib/exportarDashboard';

function pct(v) {
  return `${(Number(v || 0) * 100).toFixed(1)}%`;
}

function moneda(v) {
  return `$ ${Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
}

function numero(v) {
  return Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
}

// Mismo patrón de "barra de nivel" que en Compras: verde >=96%, amarillo
// 90-96%, rojo <90%.
function BarraNivel({ valor }) {
  const v = Number(valor || 0);
  let color = '#ef5350';
  if (v >= 0.96) color = '#66bb6a';
  else if (v >= 0.90) color = '#ffd54f';
  return (
    <div className="barra-nivel-fondo">
      <div className="barra-nivel-relleno" style={{ width: `${Math.min(v * 100, 100)}%`, backgroundColor: color }} />
    </div>
  );
}

const MEDIDAS_GRAFICO = [
  { valor: 'otif', etiqueta: 'OTIF', formato: pct },
  { valor: 'on_time', etiqueta: 'On time', formato: pct },
  { valor: 'in_full', etiqueta: 'In full', formato: pct },
  { valor: 'ns_cantidad', etiqueta: 'NS Cantidad', formato: pct },
  { valor: 'ns_valor', etiqueta: 'NS Valor', formato: pct },
];

const ETIQUETAS_CAMPO_CRUZADO = {
  proveedor: 'Proveedor',
  desc_item: 'Desc. item',
  referencia: 'Referencia',
  motivo: 'Motivo (incumplimiento en tiempo)',
  motivo_faltante: 'Motivo (faltante de ítem)',
  co: 'C.O.',
};

function TooltipGrafico({ active, payload, label, medida }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: '#0d47a1', color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 12 }}>
      <div><b>C.O. {label}</b></div>
      <div>{medida.etiqueta}: {medida.formato(payload[0].value)}</div>
    </div>
  );
}

// Etiqueta de valor sobre cada barra: fondo propio para que se lea bien
// sobre cualquier color de fondo (tema claro u oscuro).
function EtiquetaValorBarra({ x, y, width, value, formatter }) {
  if (value === undefined || value === null) return null;
  const texto = formatter(value);
  const ancho = Math.max(34, texto.length * 6.6 + 10);
  const cx = x + width / 2;
  return (
    <g>
      <rect x={cx - ancho / 2} y={y - 20} width={ancho} height={16} rx={3} fill="#ffca28" stroke="#e65100" strokeWidth={0.5} />
      <text x={cx} y={y - 8} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#5d3a00">{texto}</text>
    </g>
  );
}

export default function Dashboard({ tema, alternarTema }) {
  const [fechaInicio, setFechaInicio] = useState(primerDiaMesActual());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [co, setCo] = useState('');
  const [cosDisponibles, setCosDisponibles] = useState([]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [medidaGrafico, setMedidaGrafico] = useState('otif');
  const [seleccionCruzada, setSeleccionCruzada] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [exportandoPPT, setExportandoPPT] = useState(false);

  async function cargarCOs() {
    const { data } = await supabase.from('pedidos_detalle').select('co');
    setCosDisponibles([...new Set((data || []).map((r) => r.co).filter(Boolean))].sort());
  }

  async function cargar() {
    setCargando(true);
    setError('');
    const { data, error } = await supabase.rpc('get_ns_proveedores_dashboard', {
      co_list: co ? [co] : null,
      fecha_inicio: fechaInicio || null,
      fecha_fin: fechaFin || null,
      cross_campo: seleccionCruzada?.campo || null,
      cross_valor: seleccionCruzada?.valor != null ? String(seleccionCruzada.valor) : null,
    });
    if (error) {
      setError(error.message);
      setDatos(null);
    } else {
      setDatos(data);
    }
    setCargando(false);
  }

  useEffect(() => {
    cargarCOs();
  }, []);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaInicio, fechaFin, co, seleccionCruzada]);

  function alSeleccionarFila(campo, valor) {
    if (!campo || valor === null || valor === undefined) return;
    setSeleccionCruzada((prev) => (prev && prev.campo === campo && prev.valor === valor ? null : { campo, valor }));
  }

  const t = datos?.tarjetas;
  const porProveedor = datos?.por_proveedor || [];
  const porProveedorClase = datos?.por_proveedor_clase || [];
  const porReferenciaClase = datos?.por_referencia_clase || [];
  const porCo = datos?.por_co || [];
  const porMotivoFaltante = datos?.por_motivo_faltante || [];
  const porMotivoIncumplimiento = datos?.por_motivo_incumplimiento || [];
  const porItem = datos?.por_item || [];

  const medida = MEDIDAS_GRAFICO.find((m) => m.valor === medidaGrafico);
  const datosGrafico = useMemo(
    () => porCo.map((r) => ({ co: r.co, valor: Number(r[medidaGrafico] || 0) })),
    [porCo, medidaGrafico]
  );

  const cuadros = datos ? {
    por_proveedor: porProveedor,
    por_proveedor_clase: porProveedorClase,
    por_referencia_clase: porReferenciaClase,
    por_item: porItem,
    por_motivo_faltante: porMotivoFaltante,
    por_motivo_incumplimiento: porMotivoIncumplimiento,
    por_co: porCo,
  } : null;

  function resumenFiltrosTexto() {
    const partes = [`Del ${fechaInicio || '(sin límite)'} al ${fechaFin || '(sin límite)'}`];
    if (co) partes.push(`C.O. ${co}`);
    if (seleccionCruzada) partes.push(`${ETIQUETAS_CAMPO_CRUZADO[seleccionCruzada.campo] || seleccionCruzada.campo}: ${seleccionCruzada.valor}`);
    return partes.join('  •  ');
  }

  async function exportarExcel() {
    setExportando(true);
    try {
      await exportarDashboardExcel({
        tarjetas: t,
        cuadros,
        nombreArchivo: `dashboard_ns_proveedores_${fechaInicio || 'inicio'}_a_${fechaFin || 'hoy'}.xlsx`,
      });
    } catch (e) {
      setError(e.message || 'Error exportando a Excel.');
    } finally {
      setExportando(false);
    }
  }

  async function exportarPPT() {
    setExportandoPPT(true);
    try {
      await exportarDashboardPowerPoint({
        tarjetas: t,
        cuadros,
        medidaGrafico: medida,
        resumenFiltros: resumenFiltrosTexto(),
        nombreArchivo: `dashboard_ns_proveedores_${fechaInicio || 'inicio'}_a_${fechaFin || 'hoy'}.pptx`,
      });
    } catch (e) {
      setError(e.message || 'Error exportando a PowerPoint.');
    } finally {
      setExportandoPPT(false);
    }
  }

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="dashboard">
      <h2>Dashboard</h2>

      <div className="panel-dashboard panel-filtros" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
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
        <button onClick={exportarExcel} disabled={exportando || !datos}>{exportando ? 'Exportando...' : 'Exportar a Excel'}</button>
        <button onClick={exportarPPT} disabled={exportandoPPT || !datos}>{exportandoPPT ? 'Exportando...' : 'Exportar a PowerPoint'}</button>
        <button onClick={cargar} disabled={cargando}>{cargando ? 'Actualizando...' : 'Actualizar'}</button>
      </div>

      {seleccionCruzada && (
        <div className="chip-filtro-activo">
          Filtrando por {ETIQUETAS_CAMPO_CRUZADO[seleccionCruzada.campo] || seleccionCruzada.campo}: {String(seleccionCruzada.valor)}
          <button onClick={() => setSeleccionCruzada(null)}>✕</button>
        </div>
      )}

      <p style={{ fontSize: 11, opacity: 0.7, maxWidth: 700, marginTop: -6 }}>
        Haz clic en una fila de cualquier cuadro (o en una barra del gráfico) para filtrar el resto del Dashboard por ese
        dato, como en Power BI. Las columnas de cada cuadro se pueden arrastrar desde el borde derecho del encabezado
        para cambiar su ancho.
      </p>

      {error && <p className="error-text">{error}</p>}
      {cargando && <p className="indicador-actualizando">Cargando...</p>}

      {t && (
        <div className="tarjetas">
          <div className="tarjeta">
            <h3>Cantidades</h3>
            <div className="fila"><span>Solicitada</span><b>{numero(t.cantidad_solicitada)}</b></div>
            <div className="fila"><span>Pendiente</span><b>{numero(t.cantidad_pendiente)}</b></div>
            <div className="fila"><span>Entregada</span><b>{numero(t.cantidad_entregada)}</b></div>
            <p className="formula-tarjeta">Indicador = entregada / solicitada</p>
            <div className="valor-grande-tarjeta">{pct(t.indicador_cantidad)}</div>
            <BarraNivel valor={t.indicador_cantidad} />
          </div>

          <div className="tarjeta">
            <h3>Órdenes de compra</h3>
            <div className="fila"><span>Emitidas</span><b>{t.ordenes_emitidas}</b></div>
            <div className="fila"><span>Sin pendientes (in full)</span><b>{t.ordenes_sin_pendientes}</b></div>
            <div className="fila"><span>Completas (OTIF)</span><b>{t.ordenes_completas}</b></div>
            <p className="formula-tarjeta">Indicador = sin pendientes / emitidas (in full)</p>
            <div className="valor-grande-tarjeta">{pct(t.in_full)}</div>
            <BarraNivel valor={t.in_full} />
          </div>

          <div className="tarjeta">
            <h3>Tiempo de entrega</h3>
            <div className="fila"><span>Órdenes admitidas</span><b>{t.ordenes_emitidas}</b></div>
            <div className="fila"><span>Entregadas a tiempo</span><b>{t.ordenes_a_tiempo}</b></div>
            <div className="fila"><span>Incumplidas</span><b>{t.ordenes_incumplidas}</b></div>
            <p className="formula-tarjeta">NS = entregadas a tiempo / admitidas</p>
            <div className="valor-grande-tarjeta">{pct(t.on_time)}</div>
            <BarraNivel valor={t.on_time} />
          </div>

          <div className="tarjeta">
            <h3>OTIF</h3>
            <div className="fila"><span>On time</span><b>{pct(t.on_time)}</b></div>
            <div className="fila"><span>In full</span><b>{pct(t.in_full)}</b></div>
            <div className="fila"><span>Valor solicitado</span><b>{moneda(t.valor_solicitado)}</b></div>
            <div className="fila"><span>Valor pendiente</span><b>{moneda(t.valor_pendiente)}</b></div>
            <p className="formula-tarjeta">OTIF = on time × in full</p>
            <div className="valor-grande-tarjeta">{pct(t.otif)}</div>
            <BarraNivel valor={t.otif} />
          </div>

          <div className="tarjeta">
            <h3>Valor</h3>
            <div className="fila"><span>Solicitado</span><b>{moneda(t.valor_solicitado)}</b></div>
            <div className="fila"><span>Pendiente</span><b>{moneda(t.valor_pendiente)}</b></div>
            <div className="fila"><span>Entregado</span><b>{moneda(t.valor_entregado)}</b></div>
            <p className="formula-tarjeta">Indicador = entregado / solicitado</p>
            <div className="valor-grande-tarjeta">{pct(t.ns_valor)}</div>
            <BarraNivel valor={t.ns_valor} />
          </div>

          <div className="tarjeta">
            <h3>Líneas</h3>
            <div className="fila"><span>Solicitadas</span><b>{numero(t.lineas_totales)}</b></div>
            <div className="fila"><span>Con pendiente</span><b>{numero(t.lineas_con_pendiente)}</b></div>
            <div className="fila"><span>Entregadas</span><b>{numero(t.lineas_entregadas)}</b></div>
            <p className="formula-tarjeta">Indicador = entregadas / solicitadas</p>
            <div className="valor-grande-tarjeta">{pct(t.indicador_lineas)}</div>
            <BarraNivel valor={t.indicador_lineas} />
          </div>
        </div>
      )}

      {/*
        Rejilla de dos columnas fijas (ver .rejilla-dashboard en globals.css):
        los cuadros angostos (pocas columnas) se agrupan de a 2 por fila y los
        cuadros anchos (muchas columnas: Pareto/clasificación/detalle) ocupan
        la fila completa con la clase "panel-ancho-completo" -- así todos los
        cuadros de un mismo tipo quedan del mismo tamaño entre sí, en vez de
        que el ancho de cada uno dependa de cuántos quepan por fila.
      */}
      <div className="rejilla-dashboard">
        <div>
          <CuadroDashboard
            titulo="Valor por proveedor"
            columnas={[
              { clave: 'proveedor', etiqueta: 'Proveedor', anchoInicial: 200 },
              { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', anchoInicial: 140 },
              { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', anchoInicial: 140 },
              { clave: 'pct_pendiente', etiqueta: '% pendiente', anchoInicial: 110 },
            ]}
            filas={porProveedor}
            formateador={{ valor_solicitado: moneda, valor_pendiente: moneda, pct_pendiente: pct }}
            colorCelda={{ pct_pendiente: colorPorPorcentajePendiente }}
            campoFiltro="proveedor"
            valorSeleccionado={seleccionCruzada?.campo === 'proveedor' ? seleccionCruzada.valor : undefined}
            alSeleccionarFila={alSeleccionarFila}
          />
        </div>

        <div>
          <CuadroDashboard
            titulo="Descripción ítem — Pareto ABCD por valor solicitado"
            columnas={[
              { clave: 'desc_item', etiqueta: 'Desc. item', anchoInicial: 220 },
              { clave: 'clasificacion', etiqueta: 'ABCD', anchoInicial: 70 },
              { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', anchoInicial: 140 },
              { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', anchoInicial: 140 },
              { clave: 'ns_cantidad', etiqueta: 'NS Cantidad', anchoInicial: 110 },
              { clave: 'ns_valor', etiqueta: 'NS Valor', anchoInicial: 100 },
            ]}
            filas={porItem}
            formateador={{ valor_solicitado: moneda, valor_pendiente: moneda, ns_cantidad: pct, ns_valor: pct }}
            colorCelda={{ ns_cantidad: colorPorNsValor, ns_valor: colorPorNsValor }}
            campoFiltro="desc_item"
            valorSeleccionado={seleccionCruzada?.campo === 'desc_item' ? seleccionCruzada.valor : undefined}
            alSeleccionarFila={alSeleccionarFila}
          />
        </div>

        <div className="panel-ancho-completo">
          <CuadroDashboard
            titulo="Clasificación de proveedores (Pareto ABCD por valor solicitado)"
            columnas={[
              { clave: 'proveedor', etiqueta: 'Proveedor', anchoInicial: 190 },
              { clave: 'clasificacion', etiqueta: 'Clase', anchoInicial: 70 },
              { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', anchoInicial: 140 },
              { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', anchoInicial: 140 },
              { clave: 'otif', etiqueta: 'OTIF', anchoInicial: 90 },
              { clave: 'ns_valor', etiqueta: 'NS Valor', anchoInicial: 100 },
              { clave: 'on_time', etiqueta: 'On time', anchoInicial: 90 },
              { clave: 'in_full', etiqueta: 'In full', anchoInicial: 90 },
            ]}
            filas={porProveedor}
            formateador={{ valor_solicitado: moneda, valor_pendiente: moneda, otif: pct, ns_valor: pct, on_time: pct, in_full: pct }}
            colorCelda={{ ns_valor: colorPorNsValor }}
            campoFiltro="proveedor"
            valorSeleccionado={seleccionCruzada?.campo === 'proveedor' ? seleccionCruzada.valor : undefined}
            alSeleccionarFila={alSeleccionarFila}
          />
        </div>

        <div className="panel-ancho-completo">
          <CuadroDashboard
            titulo="Proveedores por clasificación (resumen A/B/C/D)"
            columnas={[
              { clave: 'clasificacion', etiqueta: 'Clase', anchoInicial: 70 },
              { clave: 'cantidad_proveedores', etiqueta: '# Proveedores', anchoInicial: 110 },
              { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', anchoInicial: 140 },
              { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', anchoInicial: 140 },
              { clave: 'ns_valor', etiqueta: 'NS Valor', anchoInicial: 100 },
              { clave: 'ns_cantidad', etiqueta: 'NS Cantidad', anchoInicial: 110 },
              { clave: 'ns_lineas', etiqueta: 'NS Líneas', anchoInicial: 100 },
              { clave: 'on_time', etiqueta: 'On time', anchoInicial: 90 },
              { clave: 'in_full', etiqueta: 'In full', anchoInicial: 90 },
              { clave: 'otif', etiqueta: 'OTIF', anchoInicial: 90 },
            ]}
            filas={porProveedorClase}
            formateador={{
              valor_solicitado: moneda, valor_pendiente: moneda, ns_valor: pct, ns_cantidad: pct,
              ns_lineas: pct, on_time: pct, in_full: pct, otif: pct,
            }}
            colorCelda={{ ns_valor: colorPorNsValor }}
          />
        </div>

        <div className="panel-ancho-completo">
          <CuadroDashboard
            titulo="Referencias por clasificación (resumen A/B/C/D)"
            columnas={[
              { clave: 'clasificacion', etiqueta: 'Clase', anchoInicial: 70 },
              { clave: 'cantidad_referencias', etiqueta: '# Referencias', anchoInicial: 110 },
              { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', anchoInicial: 140 },
              { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', anchoInicial: 140 },
              { clave: 'ns_valor', etiqueta: 'NS Valor', anchoInicial: 100 },
              { clave: 'ns_cantidad', etiqueta: 'NS Cantidad', anchoInicial: 110 },
              { clave: 'ns_lineas', etiqueta: 'NS Líneas', anchoInicial: 100 },
              { clave: 'on_time', etiqueta: 'On time', anchoInicial: 90 },
              { clave: 'in_full', etiqueta: 'In full', anchoInicial: 90 },
              { clave: 'otif', etiqueta: 'OTIF', anchoInicial: 90 },
            ]}
            filas={porReferenciaClase}
            formateador={{
              valor_solicitado: moneda, valor_pendiente: moneda, ns_valor: pct, ns_cantidad: pct,
              ns_lineas: pct, on_time: pct, in_full: pct, otif: pct,
            }}
            colorCelda={{ ns_valor: colorPorNsValor }}
          />
          <p style={{ fontSize: 10, opacity: 0.65, margin: '8px 0 0 0' }}>
            En el cuadro de referencias, On time / In full / OTIF se calculan por línea (no
            por orden completa), porque una referencia puede estar repartida en varias
            órdenes distintas.
          </p>
        </div>

        <div>
          <CuadroDashboard
            titulo="Motivos por faltante de ítem — valor pendiente y participación"
            columnas={[
              { clave: 'motivo', etiqueta: 'Motivo', anchoInicial: 220 },
              { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', anchoInicial: 150 },
              { clave: 'participacion', etiqueta: '% del total pendiente', anchoInicial: 150 },
            ]}
            filas={porMotivoFaltante}
            formateador={{ valor_pendiente: moneda, participacion: pct }}
            campoFiltro="motivo_faltante"
            valorSeleccionado={seleccionCruzada?.campo === 'motivo_faltante' ? seleccionCruzada.valor : undefined}
            alSeleccionarFila={alSeleccionarFila}
          />
          <p style={{ fontSize: 10, opacity: 0.65, margin: '8px 0 0 0' }}>
            Esta tabla clasifica el motivo del <b>faltante</b> (cantidad pendiente de la
            línea, columna "Observaciones"). Se asigna en Nivel de servicio, columna
            "Motivo (faltante)" — independiente del motivo de incumplimiento en tiempo de
            al lado.
          </p>
        </div>

        <div>
          <CuadroDashboard
            titulo="Motivos por incumplimiento en tiempo de entrega — valor de la orden y participación"
            columnas={[
              { clave: 'motivo', etiqueta: 'Motivo', anchoInicial: 220 },
              { clave: 'valor_orden', etiqueta: 'Valor de la orden', anchoInicial: 150 },
              { clave: 'participacion', etiqueta: '% del total', anchoInicial: 130 },
            ]}
            filas={porMotivoIncumplimiento}
            formateador={{ valor_orden: moneda, participacion: pct }}
            campoFiltro="motivo"
            valorSeleccionado={seleccionCruzada?.campo === 'motivo' ? seleccionCruzada.valor : undefined}
            alSeleccionarFila={alSeleccionarFila}
          />
          <p style={{ fontSize: 10, opacity: 0.65, margin: '8px 0 0 0' }}>
            Esta tabla clasifica el motivo del <b>incumplimiento en tiempo de entrega</b>
            (columna "Cumplimiento" = INCUMPLIDO), valorado por el valor total de la orden
            (no solo la parte pendiente). Se asigna en Novedades o en Nivel de servicio,
            columna "Motivo".
          </p>
        </div>

        <div className="panel-ancho-completo">
          <CuadroDashboard
            titulo="Detalle por C.O."
            columnas={[
              { clave: 'co', etiqueta: 'C.O.', anchoInicial: 90 },
              { clave: 'cantidad_solicitada', etiqueta: 'Cant. solicitada', anchoInicial: 130 },
              { clave: 'cantidad_pendiente', etiqueta: 'Cant. pendiente', anchoInicial: 130 },
              { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', anchoInicial: 140 },
              { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', anchoInicial: 140 },
              { clave: 'ns_valor', etiqueta: 'NS Valor', anchoInicial: 100 },
              { clave: 'ns_cantidad', etiqueta: 'NS Cantidad', anchoInicial: 110 },
              { clave: 'on_time', etiqueta: 'On time', anchoInicial: 90 },
              { clave: 'in_full', etiqueta: 'In full', anchoInicial: 90 },
              { clave: 'otif', etiqueta: 'OTIF', anchoInicial: 90 },
            ]}
            filas={porCo}
            formateador={{
              cantidad_solicitada: numero, cantidad_pendiente: numero, valor_solicitado: moneda, valor_pendiente: moneda,
              ns_valor: pct, ns_cantidad: pct, on_time: pct, in_full: pct, otif: pct,
            }}
            colorCelda={{ ns_valor: colorPorNsValor }}
            campoFiltro="co"
            valorSeleccionado={seleccionCruzada?.campo === 'co' ? seleccionCruzada.valor : undefined}
            alSeleccionarFila={alSeleccionarFila}
          />
        </div>

        <div className="panel-dashboard panel-ancho-completo">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ marginBottom: 0, border: 'none' }}>Por C.O. (clic en una barra para filtrar)</h3>
            <select value={medidaGrafico} onChange={(e) => setMedidaGrafico(e.target.value)}>
              {MEDIDAS_GRAFICO.map((m) => (
                <option key={m.valor} value={m.valor}>{m.etiqueta}</option>
              ))}
            </select>
          </div>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={datosGrafico} margin={{ top: 28, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="co" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 12 }} domain={[0, 1]} />
                <Tooltip content={<TooltipGrafico medida={medida} />} />
                <Bar
                  dataKey="valor"
                  fill="#1565c0"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={60}
                  cursor="pointer"
                  onClick={(d) => alSeleccionarFila('co', d.co)}
                >
                  <LabelList dataKey="valor" content={(p) => <EtiquetaValorBarra {...p} formatter={medida.formato} />} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Layout>
  );
}
