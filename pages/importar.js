import { useState } from 'react';
import * as XLSX from 'xlsx';
import Layout from '../components/Layout';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  leerArchivo,
  mapearFilasPedidos,
  claveUnicaPedido,
  mapearFilasEA,
  mapearFilasODC,
} from '../lib/importUtils';

// Texto exacto de la tabla de referencia que maneja el usuario (Concepto /
// Ruta / Consideraciones / Base de datos) para cada una de las 3 bases que
// se descargan del ERP. Cada base tiene su propia sección de carga, igual
// que en Compras, para que el usuario no se confunda de archivo.
const BASES = [
  {
    valor: 'pedidos_detalle',
    concepto: 'BASE',
    etiquetaCorta: 'Pedidos (ODC x Ítem / "DETALLE")',
    ruta: 'COMPRAS - CONSULTAS - ORDENES DE COMPRAS X ITEM - CONSULTA "NS PROVEEDORES BRAYI"',
    consideraciones:
      'Tipo de doc "ODC" · Fecha primer día del mes anterior a fecha anterior · Estado "CUMPLIDO" · Doble clic a la columna Notas para ordenar · Descargar archivo en formato .XLSX',
    baseDatos: 'ACUMULATIVO',
    validaDuplicados: 'Nro orden + Referencia (= "YAVE")',
  },
  {
    valor: 'entradas_ea',
    concepto: 'EA',
    etiquetaCorta: 'Entradas / EA (Evaluación de proveedores)',
    ruta: 'COMPRAS - CONSULTAS - DOCUMENTOS DE COMPRA POR ITEM - CONSULTA "EVALUACION DE PROVEEDORES JDH"',
    consideraciones:
      'Tipo de doc "EA" · Fecha del día anterior o fechas pendientes por cargar, menos el día actual · Descargar archivo en formato .XLSX',
    baseDatos: 'ACUMULATIVO',
    validaDuplicados: null,
  },
  {
    valor: 'odc_historico',
    concepto: 'ODC',
    etiquetaCorta: 'Histórico de ODC',
    ruta: 'COMPRAS - CONSULTAS - ORDENES DE COMPRA, LA CONSULTA ES BASE PEDIDOS PBI',
    consideraciones: 'Se descargan los últimos 3 meses · Descargar archivo en formato .XLSX',
    baseDatos: 'DIARIO',
    validaDuplicados: 'Nro orden (se actualiza con la fecha más reciente)',
  },
];

const TAMANO_LOTE = 500;

async function guardarLog(tipo, archivo, usuarioId, totales, insertados, omitidosDetalle, duracionMs) {
  await supabase.from('import_logs').insert({
    tipo,
    archivo,
    usuario_id: usuarioId,
    registros_totales: totales,
    registros_insertados: insertados,
    registros_omitidos: omitidosDetalle.length,
    errores: omitidosDetalle.map((o) => ({ fila: o.fila, error: o.motivo })),
    omitidos_detalle: omitidosDetalle,
    duracion_ms: duracionMs,
  });
}

// Aplica la corrección automática de "Fecha orden" (contra el histórico de
// ODC) y deja marcadas para revisión manual las líneas que sigan sin
// resolverse. Se llama automáticamente después de importar cualquier base
// que pueda afectar el cálculo (Pedidos, EA, o el histórico de ODC).
async function correrCorreccionFechas() {
  const { data, error } = await supabase.rpc('corregir_fechas_orden_ns_proveedores');
  if (error) return { error: error.message };
  return data?.[0] || null;
}

async function procesarPedidos(file, usuarioId) {
  const inicio = performance.now();
  const filasCrudas = await leerArchivo(file);
  const { filas, erroresFilas } = mapearFilasPedidos(filasCrudas);
  const omitidosDetalle = erroresFilas.map((e) => ({ motivo: e.error, fila: e.fila, ...e }));

  const porClave = new Map();
  for (const fila of filas) porClave.set(claveUnicaPedido(fila), fila);
  const filasUnicas = [...porClave.values()];
  if (filas.length - filasUnicas.length > 0) {
    omitidosDetalle.push({
      motivo: `${filas.length - filasUnicas.length} línea(s) venían repetidas dentro del mismo archivo (se conservó solo una copia de cada una, con el último valor)`,
    });
  }

  let insertados = 0;
  for (let i = 0; i < filasUnicas.length; i += TAMANO_LOTE) {
    const lote = filasUnicas.slice(i, i + TAMANO_LOTE).map((f) => ({ ...f, cargado_por: usuarioId }));
    const { data, error } = await supabase
      .from('pedidos_detalle')
      .upsert(lote, { onConflict: 'yave', ignoreDuplicates: true })
      .select('yave');

    if (error) {
      for (const fila of lote) {
        const { error: errFila } = await supabase
          .from('pedidos_detalle')
          .upsert([fila], { onConflict: 'yave', ignoreDuplicates: true });
        if (errFila) omitidosDetalle.push({ motivo: `Error al guardar: ${errFila.message}`, ...fila });
        else insertados++;
      }
    } else {
      const clavesInsertadas = new Set((data || []).map((r) => r.yave));
      insertados += clavesInsertadas.size;
      for (const fila of lote) {
        if (!clavesInsertadas.has(fila.yave)) {
          omitidosDetalle.push({ motivo: 'Duplicado (ya existe en la base, Nro orden + Referencia)', ...fila });
        }
      }
    }
  }

  const duracionMs = Math.round(performance.now() - inicio);
  await guardarLog('pedidos_detalle', file.name, usuarioId, filasCrudas.length, insertados, omitidosDetalle, duracionMs);

  return { tipo: 'Pedidos', archivo: file.name, totales: filasCrudas.length, insertados, omitidosDetalle, duracionMs, requiereCorreccion: true };
}

async function procesarEA(file, usuarioId) {
  const inicio = performance.now();
  const filasCrudas = await leerArchivo(file);
  const { filas, erroresFilas } = mapearFilasEA(filasCrudas);
  const omitidosDetalle = erroresFilas.map((e) => ({ motivo: e.error, fila: e.fila, ...e }));

  const registros = filas.map((f) => ({ ...f, archivo_origen: file.name, cargado_por: usuarioId }));
  let insertados = 0;
  for (let i = 0; i < registros.length; i += TAMANO_LOTE) {
    const lote = registros.slice(i, i + TAMANO_LOTE);
    const { error } = await supabase.from('entradas_ea').insert(lote);
    if (error) {
      for (const fila of lote) {
        const { error: errFila } = await supabase.from('entradas_ea').insert([fila]);
        if (errFila) omitidosDetalle.push({ motivo: `Error al guardar: ${errFila.message}`, ...fila });
        else insertados++;
      }
    } else {
      insertados += lote.length;
    }
  }

  const duracionMs = Math.round(performance.now() - inicio);
  await guardarLog('entradas_ea', file.name, usuarioId, filasCrudas.length, insertados, omitidosDetalle, duracionMs);

  return { tipo: 'Entradas / EA', archivo: file.name, totales: filasCrudas.length, insertados, omitidosDetalle, duracionMs, requiereCorreccion: true };
}

async function procesarODC(file, usuarioId) {
  const inicio = performance.now();
  const filasCrudas = await leerArchivo(file);
  const { filas, erroresFilas } = mapearFilasODC(filasCrudas);
  const omitidosDetalle = erroresFilas.map((e) => ({ motivo: e.error, fila: e.fila, ...e }));

  // Si el mismo archivo trae la misma orden repetida, se usa la fecha más
  // reciente que traiga (por si la orden tuvo una modificación posterior).
  const porOrden = new Map();
  for (const fila of filas) {
    const anterior = porOrden.get(fila.nro_orden);
    if (!anterior || fila.fecha > anterior.fecha) porOrden.set(fila.nro_orden, fila);
  }
  const filasUnicas = [...porOrden.values()];

  const registros = filasUnicas.map((f) => ({ ...f, archivo_origen: file.name, cargado_por: usuarioId }));
  let insertados = 0;
  for (let i = 0; i < registros.length; i += TAMANO_LOTE) {
    const lote = registros.slice(i, i + TAMANO_LOTE);
    const { error } = await supabase.from('odc_historico').upsert(lote, { onConflict: 'nro_orden' });
    if (error) {
      for (const fila of lote) {
        const { error: errFila } = await supabase.from('odc_historico').upsert([fila], { onConflict: 'nro_orden' });
        if (errFila) omitidosDetalle.push({ motivo: `Error al guardar: ${errFila.message}`, ...fila });
        else insertados++;
      }
    } else {
      insertados += lote.length;
    }
  }

  const duracionMs = Math.round(performance.now() - inicio);
  await guardarLog('odc_historico', file.name, usuarioId, filasCrudas.length, insertados, omitidosDetalle, duracionMs);

  return { tipo: 'Histórico de ODC', archivo: file.name, totales: filasCrudas.length, insertados, omitidosDetalle, duracionMs, requiereCorreccion: true };
}

function exportarOmitidos(resultado) {
  const filas = resultado.omitidosDetalle.map((o) => ({
    'Motivo del descarte': o.motivo || '',
    'Fila del archivo': o.fila ?? '',
    'Nro orden': o.nro_orden ?? '',
    'C.O.': o.co ?? '',
    Proveedor: o.proveedor ?? '',
    Referencia: o.referencia ?? '',
    'Desc. item': o.desc_item ?? '',
  }));
  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Omitidos');
  XLSX.writeFile(libro, `omitidos_${resultado.tipo}_${resultado.archivo}.xlsx`);
}

function procesar(tipoValor, archivo, usuarioId) {
  if (tipoValor === 'pedidos_detalle') return procesarPedidos(archivo, usuarioId);
  if (tipoValor === 'entradas_ea') return procesarEA(archivo, usuarioId);
  if (tipoValor === 'odc_historico') return procesarODC(archivo, usuarioId);
  return null;
}

function TarjetaImportacion({ base, archivo, procesando, error, resultado, onArchivo, onImportar, onDescargarOmitidos }) {
  return (
    <div className="panel-dashboard" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 4 }}>
            {base.concepto} <span style={{ fontWeight: 400, opacity: 0.75 }}>· {base.etiquetaCorta}</span>
          </h3>
        </div>
        <span
          title="Frecuencia de esta base"
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: 12,
            background: base.baseDatos === 'DIARIO' ? '#ffecb3' : '#c8e6c9',
            color: '#333',
            whiteSpace: 'nowrap',
          }}
        >
          {base.baseDatos}
        </span>
      </div>

      <p style={{ fontSize: 12, margin: '4px 0' }}>
        <b>Ruta:</b> {base.ruta}
      </p>
      <p style={{ fontSize: 12, margin: '4px 0 10px' }}>
        <b>Consideraciones:</b> {base.consideraciones}
      </p>
      {base.validaDuplicados && (
        <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 10px' }}>
          Valida duplicados por: {base.validaDuplicados}
        </p>
      )}

      <div className="fila-importar" style={{ paddingTop: 0, borderTop: 'none' }}>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => onArchivo(e.target.files[0])}
        />
        <button onClick={onImportar} disabled={!archivo || procesando}>
          {procesando ? 'Procesando...' : 'Importar'}
        </button>
        {error && <span className="error-text">{error}</span>}
      </div>

      {resultado && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <p style={{ margin: '4px 0' }}>
            Archivo: {resultado.archivo} · {(resultado.duracionMs / 1000).toFixed(2)} s · Registros en archivo:{' '}
            {resultado.totales} · <span className="ok-text">Insertados: {resultado.insertados}</span>
            {resultado.omitidosDetalle.length > 0 && (
              <> · <span className="error-text">Omitidos: {resultado.omitidosDetalle.length}</span></>
            )}
          </p>
          {resultado.omitidosDetalle.length > 0 && (
            <div>
              <details>
                <summary className="error-text">{resultado.omitidosDetalle.length} línea(s) omitida(s)</summary>
                <ul>
                  {resultado.omitidosDetalle.slice(0, 30).map((o, j) => (
                    <li key={j}>
                      {o.motivo}
                      {o.nro_orden ? ` (Nro orden ${o.nro_orden}${o.referencia ? `, ref ${o.referencia}` : ''})` : ''}
                    </li>
                  ))}
                </ul>
                {resultado.omitidosDetalle.length > 30 && (
                  <p style={{ opacity: 0.7 }}>Mostrando 30 de {resultado.omitidosDetalle.length}. Descarga el Excel para verlas todas.</p>
                )}
              </details>
              <button onClick={onDescargarOmitidos}>Descargar omitidos en Excel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Importar({ tema, alternarTema }) {
  const { session } = useAuth();
  const [archivos, setArchivos] = useState({});
  const [procesando, setProcesando] = useState({});
  const [resultados, setResultados] = useState({});
  const [errores, setErrores] = useState({});
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [resultadoCorreccion, setResultadoCorreccion] = useState(null);

  async function manejarImportar(tipoValor) {
    const archivo = archivos[tipoValor];
    if (!archivo) return;
    setProcesando((p) => ({ ...p, [tipoValor]: true }));
    setErrores((e) => ({ ...e, [tipoValor]: '' }));
    try {
      const usuarioId = session?.user?.id;
      const resultado = await procesar(tipoValor, archivo, usuarioId);
      setResultados((prev) => ({ ...prev, [tipoValor]: resultado }));
      setArchivos((prev) => ({ ...prev, [tipoValor]: null }));

      if (resultado.requiereCorreccion) {
        setCorrigiendo(true);
        const correccion = await correrCorreccionFechas();
        setResultadoCorreccion(correccion);
        setCorrigiendo(false);
      }
    } catch (e) {
      setErrores((prev) => ({ ...prev, [tipoValor]: e.message || 'Error desconocido al importar.' }));
    } finally {
      setProcesando((p) => ({ ...p, [tipoValor]: false }));
    }
  }

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="importar">
      <h2>Importar bases de datos</h2>
      <p style={{ opacity: 0.8, maxWidth: 760 }}>
        Cada base se descarga y se carga por separado, con su propia ruta y consideraciones (igual que
        las manejas hoy). Orden recomendado: primero <b>Histórico de ODC</b>, luego <b>EA</b>, y por
        último <b>BASE (Pedidos)</b>. Cada vez que importes BASE, EA, o el histórico de ODC, el sistema
        recalcula automáticamente la corrección de fechas de orden (ver más abajo). El{' '}
        <b>Tiempo de entrega</b> por proveedor ya no se carga aquí: es un maestro editable, en{' '}
        <b>Configuración &gt; Tiempo de entrega</b>.
      </p>

      {BASES.map((base) => (
        <TarjetaImportacion
          key={base.valor}
          base={base}
          archivo={archivos[base.valor]}
          procesando={!!procesando[base.valor]}
          error={errores[base.valor]}
          resultado={resultados[base.valor]}
          onArchivo={(file) => setArchivos((prev) => ({ ...prev, [base.valor]: file }))}
          onImportar={() => manejarImportar(base.valor)}
          onDescargarOmitidos={() => exportarOmitidos(resultados[base.valor])}
        />
      ))}

      {corrigiendo && <p className="indicador-actualizando">Recalculando corrección de fechas de orden...</p>}

      {resultadoCorreccion && !resultadoCorreccion.error && (
        <div className="panel-dashboard" style={{ marginBottom: 20, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0 }}>Corrección automática de fechas de orden</h3>
          <p style={{ fontSize: 12 }}>
            Líneas evaluadas (fecha de orden = fecha de entrada): <b>{resultadoCorreccion.filas_evaluadas}</b><br />
            <span className="ok-text">Corregidas automáticamente con el histórico de ODC: <b>{resultadoCorreccion.filas_corregidas}</b></span><br />
            <span className="error-text">Pendientes de revisión manual: <b>{resultadoCorreccion.filas_pendientes_revision}</b></span>
          </p>
          <p style={{ fontSize: 11, opacity: 0.7 }}>
            Revísalas en <b>Nivel de servicio</b>, filtrando por &quot;Solo por revisar&quot;.
          </p>
        </div>
      )}
      {resultadoCorreccion?.error && (
        <p className="error-text">No se pudo recalcular la corrección de fechas: {resultadoCorreccion.error}</p>
      )}
    </Layout>
  );
}
