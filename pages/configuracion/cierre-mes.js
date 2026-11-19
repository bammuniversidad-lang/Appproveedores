import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import Layout from '../../components/Layout';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabaseClient';

// Tamaño de página normal y tamaño de respaldo. Si una página se cae por
// "statement timeout" (pasa cuando un mes trae muchas líneas y la vista
// tiene que calcular entregas, diferencias y el cruce con ODC para todas),
// se reintenta la MISMA página con menos filas en vez de perder el respaldo.
const TAMANOS_PAGINA = [1000, 250, 100];

const CLAVE_SIN_FECHA = 'SIN FECHA';

function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

// Primer y último día del mes, en texto ISO (sin pasar por la zona horaria
// del navegador, que es de donde salen los clásicos corrimientos de un día).
function rangoDelMes(anio, mes) {
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return {
    desde: `${anio}-${dosDigitos(mes)}-01`,
    hasta: `${anio}-${dosDigitos(mes)}-${dosDigitos(ultimoDia)}`,
  };
}

// Nombre pedido por el usuario: "NS PROVEEDORES 08-2026.xlsx"
function nombreArchivoMes(anio, mes) {
  return `NS PROVEEDORES ${dosDigitos(mes)}-${anio}.xlsx`;
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

// Orden final del archivo: C.O., Nro orden, id. Se ordena AQUÍ y no en la
// base a propósito -- ver el comentario de descargarMes().
function compararFilas(a, b) {
  const porCo = String(a.co ?? '').localeCompare(String(b.co ?? ''));
  if (porCo !== 0) return porCo;
  const porOrden = String(a.nro_orden ?? '').localeCompare(String(b.nro_orden ?? ''));
  if (porOrden !== 0) return porOrden;
  return (a.id ?? 0) - (b.id ?? 0);
}

export default function CierreMes({ tema, alternarTema }) {
  const { profile } = useAuth();
  const [meses, setMeses] = useState([]);
  const [totalLineas, setTotalLineas] = useState(null);
  const [descargadas, setDescargadas] = useState({}); // clave de mes -> líneas
  const [preparando, setPreparando] = useState(false);
  const [mesEnCurso, setMesEnCurso] = useState('');
  const [progreso, setProgreso] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [eliminando, setEliminando] = useState(false);

  const esAdmin = profile?.rol === 'administrador';
  const lineasDescargadas = Object.values(descargadas).reduce((a, b) => a + b, 0);
  const respaldoCompleto = totalLineas !== null && meses.length > 0
    && meses.every((m) => descargadas[m.clave] !== undefined)
    && lineasDescargadas >= totalLineas;

  // -------------------------------------------------------------------
  // 1. Qué meses hay que descargar
  // -------------------------------------------------------------------
  // Se arma leyendo SOLO la tabla pedidos_detalle (fechas sueltas), no la
  // vista: la vista calcula entregas, diferencias, días hábiles y el cruce
  // con el histórico de ODC para cada línea, así que preguntarle "cuántas
  // hay" o "desde cuándo" sobre TODA la base es justo lo que se caía con
  // "canceling statement due to statement timeout".
  async function prepararRespaldo() {
    setPreparando(true);
    setError('');
    setMensaje('');
    try {
      const extremo = async (columna, ascendente) => {
        const { data, error: e } = await supabase
          .from('pedidos_detalle')
          .select(columna)
          .not(columna, 'is', null)
          .order(columna, { ascending: ascendente })
          .limit(1);
        if (e) throw e;
        return data?.[0]?.[columna] || null;
      };

      const [minCumplido, maxCumplido, minOrden, maxOrden] = await Promise.all([
        extremo('fecha_cumplido', true),
        extremo('fecha_cumplido', false),
        extremo('fecha_orden', true),
        extremo('fecha_orden', false),
      ]);

      const { count: total, error: eTotal } = await supabase
        .from('pedidos_detalle')
        .select('id', { count: 'exact', head: true });
      if (eTotal) throw eTotal;

      // Líneas sin ninguna de las dos fechas: no caen en ningún mes, pero
      // TIENEN que quedar respaldadas igual (después del paso 2 ya no hay
      // de dónde sacarlas). Van a un archivo aparte.
      const { count: sinFecha, error: eSinFecha } = await supabase
        .from('pedidos_detalle')
        .select('id', { count: 'exact', head: true })
        .is('fecha_cumplido', null)
        .is('fecha_orden', null);
      if (eSinFecha) throw eSinFecha;

      const fechas = [minCumplido, maxCumplido, minOrden, maxOrden].filter(Boolean).sort();
      const lista = [];
      if (fechas.length > 0) {
        const [anioIni, mesIni] = fechas[0].split('-').map(Number);
        const [anioFin, mesFin] = fechas[fechas.length - 1].split('-').map(Number);
        let anio = anioIni;
        let mes = mesIni;
        // Tope de seguridad por si alguna fecha viene corrupta (año 1900 o
        // 2099): el respaldo no puede quedarse generando meses para siempre.
        let guarda = 0;
        while ((anio < anioFin || (anio === anioFin && mes <= mesFin)) && guarda < 240) {
          const { desde, hasta } = rangoDelMes(anio, mes);
          lista.push({
            clave: `${anio}-${dosDigitos(mes)}`,
            etiqueta: `${dosDigitos(mes)}-${anio}`,
            archivo: nombreArchivoMes(anio, mes),
            desde,
            hasta,
          });
          mes += 1;
          if (mes > 12) { mes = 1; anio += 1; }
          guarda += 1;
        }
      }
      if (sinFecha > 0) {
        lista.push({
          clave: CLAVE_SIN_FECHA,
          etiqueta: 'Sin fecha',
          archivo: 'NS PROVEEDORES SIN FECHA.xlsx',
          sinFecha: true,
        });
      }

      setMeses(lista);
      setTotalLineas(total ?? 0);
      setDescargadas({});
      if (lista.length === 0) setMensaje('No hay líneas acumuladas: no hay nada que respaldar.');
    } catch (e) {
      setError(e.message || 'Error revisando qué meses hay en la base.');
    } finally {
      setPreparando(false);
    }
  }

  useEffect(() => {
    prepararRespaldo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------
  // 2. Descargar un mes
  // -------------------------------------------------------------------
  // Dos decisiones aquí que son las que quitan el timeout:
  //
  //  a) Se pide UN MES A LA VEZ. Antes se pedía la vista completa, sin
  //     filtro de fecha: la base tenía que calcular el nivel de servicio de
  //     TODAS las líneas acumuladas en una sola sentencia y se pasaba del
  //     límite de 30s. Con el filtro por mes cada consulta es del tamaño de
  //     lo que ya carga la pantalla de Nivel de servicio.
  //
  //  b) La paginación es por "id" (keyset: "dame las siguientes 1000 con id
  //     mayor al último que recibí"), no por "range/offset". Con offset, la
  //     base tiene que volver a calcular y ordenar TODO lo anterior en cada
  //     página -- la última página de un mes grande es la que se caía. Con
  //     keyset cada página cuesta lo mismo que la primera. Por eso el orden
  //     final (C.O., Nro orden) se arma aquí en el navegador y no en la base.
  async function descargarMes(m) {
    setMesEnCurso(m.clave);
    const filtradoDe = (consulta) => (
      m.sinFecha
        ? consulta.is('fecha_referencia', null)
        : consulta.gte('fecha_referencia', m.desde).lte('fecha_referencia', m.hasta)
    );

    let ultimoId = 0;
    const filas = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let data = null;
      let errorPagina = null;
      let tamanoUsado = TAMANOS_PAGINA[0];
      for (const tamano of TAMANOS_PAGINA) {
        const respuesta = await filtradoDe(supabase.from('v_ns_proveedores').select('*'))
          .gt('id', ultimoId)
          .order('id', { ascending: true })
          .limit(tamano);
        if (!respuesta.error) {
          data = respuesta.data || [];
          errorPagina = null;
          tamanoUsado = tamano;
          break;
        }
        errorPagina = respuesta.error;
        // Solo tiene sentido reintentar más pequeño si fue por tiempo.
        if (!/timeout|tiempo/i.test(respuesta.error.message || '')) break;
      }
      if (errorPagina) throw errorPagina;

      filas.push(...data);
      setProgreso(`${m.etiqueta}: ${filas.length} línea(s)...`);
      if (data.length < tamanoUsado) break;
      ultimoId = data[data.length - 1].id;
    }

    if (filas.length > 0) {
      filas.sort(compararFilas);
      const hoja = XLSX.utils.json_to_sheet(filas.map(filaParaExcel));
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, 'NS Proveedores');
      XLSX.writeFile(libro, m.archivo);
    }
    setDescargadas((prev) => ({ ...prev, [m.clave]: filas.length }));
    setProgreso('');
    setMesEnCurso('');
    return filas.length;
  }

  async function descargarUno(m) {
    setError('');
    setMensaje('');
    try {
      const n = await descargarMes(m);
      setMensaje(n > 0 ? `"${m.archivo}" descargado con ${n} registro(s).` : `${m.etiqueta}: no hay líneas en ese mes, no se generó archivo.`);
    } catch (e) {
      setMesEnCurso('');
      setProgreso('');
      setError(`${m.etiqueta}: ${e.message || 'error descargando el respaldo.'}`);
    }
  }

  async function descargarTodos() {
    setError('');
    setMensaje('');
    let generados = 0;
    let lineas = 0;
    try {
      for (const m of meses) {
        const n = await descargarMes(m);
        lineas += n;
        if (n > 0) generados += 1;
        // El navegador pide permiso para bajar varios archivos seguidos y
        // puede descartar los que lleguen demasiado juntos: se le da aire
        // entre uno y otro.
        await new Promise((r) => setTimeout(r, 600));
      }
      setMensaje(`${generados} archivo(s) descargado(s) con ${lineas} línea(s) en total.`);
    } catch (e) {
      setMesEnCurso('');
      setProgreso('');
      setError(`${e.message || 'Error descargando el respaldo.'} — se alcanzaron a descargar ${lineas} línea(s). Puedes reintentar solo el mes que falló con su propio botón.`);
    }
  }

  async function eliminarTodo() {
    setEliminando(true);
    setError('');
    setMensaje('');
    try {
      const { data, error: e } = await supabase.rpc('eliminar_periodo_ns_proveedores');
      if (e) throw e;
      const resultado = data?.[0];
      setMensaje(
        `Se eliminaron ${resultado?.pedidos_eliminados ?? 0} línea(s) de Pedidos y ${resultado?.entradas_eliminadas ?? 0} línea(s) de EA. La base quedó lista para el nuevo periodo.`
      );
      setConfirmacion('');
      prepararRespaldo();
    } catch (e) {
      setError(e.message || 'Error eliminando los registros.');
    } finally {
      setEliminando(false);
    }
  }

  const ocupado = preparando || mesEnCurso !== '';

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="configuracion_cierre_mes">
      <h2>Cierre de mes</h2>
      <p style={{ opacity: 0.8, maxWidth: 700 }}>
        Igual que en Compras: descarga primero el respaldo en Excel con todo lo acumulado en el
        periodo (Pedidos/BASE + los cálculos de nivel de servicio) y luego vacía las tablas de
        <b> Pedidos</b> y <b> Entradas/EA</b> para que el próximo periodo arranque liviano. El
        histórico de <b>ODC</b> y el maestro de <b>Tiempo de entrega</b> NO se tocan.
      </p>

      <div className="panel-dashboard" style={{ maxWidth: 700, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>1. Descargar el respaldo (un archivo por mes)</h3>
        <p style={{ fontSize: 11, opacity: 0.8, margin: '0 0 6px 0' }}>
          Se genera un Excel por cada mes con datos, con el nombre{' '}
          <b>NS PROVEEDORES MES-AÑO</b> (por ejemplo <b>NS PROVEEDORES 08-2026.xlsx</b>). Cada
          archivo trae las mismas 24 columnas y el mismo orden de tu base actual (YAVE, Fecha de
          cumplido, Nro orden, CO, Bodega, PROVEEDOR, Referencia, Desc. item, cantidades, Fecha
          orden, Precio unit., Valor bruto, Docto referencia, Notas documento, V PENDIENTE,
          OBSERVACIONES, FECHA DE ENTREGA REAL, DIFERENCIA, OBSERVACION 2, MOTIVO DE
          INCUMPLIMIENTO, VALIDACION, Validación).
        </p>
        <p style={{ fontSize: 11, opacity: 0.8, margin: '0 0 10px 0' }}>
          El mes de cada línea se decide por la <b>fecha de cumplido</b> (si esa línea no la
          tiene, por la fecha de orden) — el mismo criterio del rango Desde/Hasta de Nivel de
          servicio, así que los archivos cuadran con lo que ves en pantalla. Al descargar varios
          seguidos el navegador puede preguntar si permites <b>descargar varios archivos</b>:
          hay que aceptar. Si prefieres, baja mes por mes con el botón de cada fila.
        </p>

        {preparando && <p style={{ fontSize: 12 }}>Revisando qué meses hay en la base...</p>}

        {!preparando && meses.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <button onClick={descargarTodos} disabled={ocupado}>
                {mesEnCurso ? 'Descargando...' : 'Descargar todos los meses'}
              </button>
              <button onClick={prepararRespaldo} disabled={ocupado}>Actualizar lista</button>
            </div>

            <table style={{ width: '100%', maxWidth: 560 }}>
              <thead>
                <tr><th>Periodo</th><th>Archivo</th><th>Estado</th><th /></tr>
              </thead>
              <tbody>
                {meses.map((m) => (
                  <tr key={m.clave}>
                    <td>{m.etiqueta}</td>
                    <td style={{ fontSize: 11 }}>{m.archivo}</td>
                    <td style={{ fontSize: 11 }}>
                      {mesEnCurso === m.clave
                        ? (progreso || 'Descargando...')
                        : descargadas[m.clave] === undefined
                          ? '-'
                          : descargadas[m.clave] === 0
                            ? 'sin líneas'
                            : `✔ ${descargadas[m.clave]} línea(s)`}
                    </td>
                    <td>
                      <button onClick={() => descargarUno(m)} disabled={ocupado}>Descargar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalLineas !== null && (
              <p style={{ fontSize: 11, opacity: 0.85, marginTop: 8 }}>
                Respaldadas <b>{lineasDescargadas}</b> de <b>{totalLineas}</b> línea(s) de la base.
                {respaldoCompleto && ' El respaldo está completo.'}
              </p>
            )}
          </>
        )}
      </div>

      {esAdmin ? (
        <div className="panel-dashboard" style={{ maxWidth: 700, borderColor: '#b71c1c' }}>
          <h3 style={{ marginTop: 0 }} className="error-text">2. Eliminar Pedidos y Entradas/EA (empezar periodo nuevo)</h3>
          <p style={{ fontSize: 11, opacity: 0.8 }}>
            <b>Esta acción no se puede deshacer.</b> Borra TODA la tabla de Pedidos y TODA la de
            Entradas/EA (todos los C.O. y todas las fechas). El histórico de ODC, el maestro de
            Tiempo de entrega, los Motivos y los Usuarios NO se tocan. Asegúrate de haber
            descargado el respaldo primero.
          </p>
          {!respaldoCompleto && (
            <p className="error-text" style={{ fontSize: 11 }}>
              Todavía faltan meses por descargar ({lineasDescargadas} de {totalLineas ?? '?'} líneas
              respaldadas). Descarga el respaldo completo de arriba primero (o si ya tienes el
              respaldo de otra forma, puedes continuar bajo tu propio criterio).
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
