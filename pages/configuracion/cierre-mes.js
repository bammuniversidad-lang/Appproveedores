import { useState } from 'react';
import * as XLSX from 'xlsx';
import Layout from '../../components/Layout';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { hoyISO } from '../../lib/fechas';

const TAMANO_PAGINA = 1000;

const MESES_ABREVIADOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

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

// "2026-05-14" -> "may-26"
function nombreMesAbreviado(fechaISO) {
  const [anio, mes] = fechaISO.split('-').map(Number);
  return `${MESES_ABREVIADOS[mes - 1]}-${String(anio).slice(2)}`;
}

// Columnas y orden EXACTOS pedidos por el usuario para el respaldo del
// cierre de mes. La mayoría vienen directo de v_ns_proveedores (misma
// vista que usa Nivel de servicio). "VALIDACION" y "Validación" son dos
// chequeos de auditoría que no existían como campos sueltos en el Excel
// original (esa columna tenía un desfase de fila, ver README) -- se
// construyen aquí con lógica clara y se pueden ajustar si no es lo que
// esperabas:
//   - VALIDACION: si la línea quedó INCUMPLIDA, si ya tiene motivo asignado.
//   - Validación: rastro de la corrección automática de "Fecha orden".
function filaParaExcel(f) {
  let validacion = 'N/A';
  if (f.observacion2 === 'INCUMPLIDO') validacion = f.motivo_id ? 'CON MOTIVO' : 'FALTA MOTIVO';

  let validacionFecha = 'OK';
  if (f.necesita_revision) validacionFecha = 'PENDIENTE REVISION FECHA';
  else if (f.fecha_orden_corregida) validacionFecha = 'FECHA CORREGIDA AUTOMATICA';

  return {
    YAVE: f.yave,
    'Fecha de cumplido': f.fecha_cumplido,
    'Nro orden': f.nro_orden,
    CO: f.co,
    Bodega: f.bodega,
    PROVEEDOR: f.proveedor,
    Referencia: f.referencia,
    'Desc. item': f.desc_item,
    'Cant. ordenada': f.cant_ordenada,
    'Cant. entrada inv.': f.cant_entrada_inv,
    'Cant. pendiente inv.': f.cant_pendiente_inv,
    'Fecha orden': f.fecha_orden,
    'Precio unit.': f.precio_unit,
    'Valor bruto': f.valor_bruto,
    'Docto referencia': f.docto_referencia,
    'Notas documento': f.notas_documento,
    'V PENDIENTE': f.v_pendiente,
    OBSERVACIONES: f.observaciones,
    'FECHA DE ENTREGA REAL': f.fecha_entrega_real,
    DIFERENCIA: f.diferencia,
    'OBSERVACION 2': f.observacion2,
    'MOTIVO DE INCUMPLIMIENTO': f.motivo_nombre,
    VALIDACION: validacion,
    Validación: validacionFecha,
  };
}

export default function CierreMes({ tema, alternarTema }) {
  const { profile } = useAuth();
  const [descargando, setDescargando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [yaDescargo, setYaDescargo] = useState(false);
  const [confirmacion, setConfirmacion] = useState('');
  const [eliminando, setEliminando] = useState(false);

  const esAdmin = profile?.rol === 'administrador';

  async function descargarBaseAcumulada() {
    setDescargando(true);
    setError('');
    setMensaje('');
    try {
      const datos = await obtenerTodo(() =>
        supabase.from('v_ns_proveedores').select('*').order('co').order('nro_orden')
      );
      const filas = datos.map(filaParaExcel);
      const nombreArchivo = `NS PROVEEDORES - ${nombreMesAbreviado(hoyISO())}.xlsx`;
      const hoja = XLSX.utils.json_to_sheet(filas);
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, 'NS Proveedores');
      XLSX.writeFile(libro, nombreArchivo);
      setMensaje(`"${nombreArchivo}" descargado con ${filas.length} registro(s).`);
      setYaDescargo(true);
    } catch (e) {
      setError(e.message || 'Error descargando la base acumulada.');
    } finally {
      setDescargando(false);
    }
  }

  async function eliminarTodo() {
    setEliminando(true);
    setError('');
    setMensaje('');
    try {
      const { data, error } = await supabase.rpc('eliminar_periodo_ns_proveedores');
      if (error) throw error;
      const resultado = data?.[0];
      setMensaje(
        `Se eliminaron ${resultado?.pedidos_eliminados ?? 0} línea(s) de Pedidos y ${resultado?.entradas_eliminadas ?? 0} línea(s) de EA. La base quedó lista para el nuevo periodo.`
      );
      setYaDescargo(false);
      setConfirmacion('');
    } catch (e) {
      setError(e.message || 'Error eliminando los registros.');
    } finally {
      setEliminando(false);
    }
  }

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="configuracion_cierre_mes">
      <h2>Cierre de mes</h2>
      <p style={{ opacity: 0.8, maxWidth: 700 }}>
        Igual que en Compras: descarga primero el respaldo en Excel con todo lo acumulado en el
        periodo (Pedidos/BASE + los cálculos de nivel de servicio) y luego vacía las tablas de
        <b> Pedidos</b> y <b> Entradas/EA</b> para que el próximo periodo arranque liviano. El
        histórico de <b>ODC</b> y el maestro de <b>Tiempo de entrega</b> NO se tocan.
      </p>

      <div className="panel-dashboard" style={{ maxWidth: 640, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>1. Descargar el respaldo</h3>
        <p style={{ fontSize: 11, opacity: 0.8, margin: '0 0 6px 0' }}>
          Descarga TODAS las líneas acumuladas hasta hoy, con las mismas 24 columnas y el mismo
          orden de tu base actual (YAVE, Fecha de cumplido, Nro orden, CO, Bodega, PROVEEDOR,
          Referencia, Desc. item, cantidades, Fecha orden, Precio unit., Valor bruto, Docto
          referencia, Notas documento, V PENDIENTE, OBSERVACIONES, FECHA DE ENTREGA REAL,
          DIFERENCIA, OBSERVACION 2, MOTIVO DE INCUMPLIMIENTO, VALIDACION, Validación).
        </p>
        <button onClick={descargarBaseAcumulada} disabled={descargando}>
          {descargando ? 'Descargando...' : 'Descargar base acumulada'}
        </button>
      </div>

      {esAdmin ? (
        <div className="panel-dashboard" style={{ maxWidth: 640, borderColor: '#b71c1c' }}>
          <h3 style={{ marginTop: 0 }} className="error-text">2. Eliminar Pedidos y Entradas/EA (empezar periodo nuevo)</h3>
          <p style={{ fontSize: 11, opacity: 0.8 }}>
            <b>Esta acción no se puede deshacer.</b> Borra TODA la tabla de Pedidos y TODA la de
            Entradas/EA (todos los C.O. y todas las fechas). El histórico de ODC, el maestro de
            Tiempo de entrega, los Motivos y los Usuarios NO se tocan. Asegúrate de haber
            descargado el respaldo primero.
          </p>
          {!yaDescargo && (
            <p className="error-text" style={{ fontSize: 11 }}>
              Descarga el respaldo de arriba primero (o si ya tienes el respaldo de otra forma,
              puedes continuar bajo tu propio criterio).
            </p>
          )}
          <div style={{ marginBottom: 10 }}>
            <label>Escribe ELIMINAR para confirmar</label><br />
            <input value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} style={{ width: 200 }} />
          </div>
          <button
            onClick={eliminarTodo}
            disabled={eliminando || confirmacion !== 'ELIMINAR'}
            style={{ backgroundColor: '#b71c1c', color: '#fff', borderColor: '#7f0000' }}
          >
            {eliminando ? 'Eliminando...' : 'Eliminar Pedidos y Entradas/EA'}
          </button>
        </div>
      ) : (
        <p style={{ opacity: 0.7 }}>Solo un administrador puede hacer el cierre de mes.</p>
      )}

      {mensaje && <p className="ok-text" style={{ marginTop: 12 }}>{mensaje}</p>}
      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
    </Layout>
  );
}
