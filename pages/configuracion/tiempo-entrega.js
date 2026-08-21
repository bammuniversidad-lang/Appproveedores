import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { supabase } from '../../lib/supabaseClient';
import { leerArchivo, mapearFilasTiempoEntrega } from '../../lib/importUtils';

const CAMPO_VACIO = {
  co: '',
  proveedor: '',
  tipo_entrega: '',
  dias_entrega: '',
  nit: '',
  condicion_pago: '',
  sucursal: '',
  pedido_minimo_valor: '',
  pedido_minimo_peso: '',
  pedido_minimo_volumen: '',
  pedido_minimo_cajas: '',
  pedido_minimo_unidades: '',
};

function aRegistro(form) {
  return {
    co: String(form.co).trim(),
    proveedor: String(form.proveedor).trim(),
    tipo_entrega: form.tipo_entrega ? String(form.tipo_entrega).trim() : null,
    dias_entrega: form.dias_entrega === '' ? 0 : Number(form.dias_entrega),
    nit: form.nit ? String(form.nit).trim() : null,
    condicion_pago: form.condicion_pago ? String(form.condicion_pago).trim() : null,
    sucursal: form.sucursal ? String(form.sucursal).trim() : null,
    pedido_minimo_valor: form.pedido_minimo_valor === '' ? null : Number(form.pedido_minimo_valor),
    pedido_minimo_peso: form.pedido_minimo_peso === '' ? null : Number(form.pedido_minimo_peso),
    pedido_minimo_volumen: form.pedido_minimo_volumen === '' ? null : Number(form.pedido_minimo_volumen),
    pedido_minimo_cajas: form.pedido_minimo_cajas === '' ? null : Number(form.pedido_minimo_cajas),
    pedido_minimo_unidades: form.pedido_minimo_unidades === '' ? null : Number(form.pedido_minimo_unidades),
  };
}

export default function TiempoEntrega({ tema, alternarTema }) {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState('');

  const [nuevo, setNuevo] = useState(CAMPO_VACIO);
  const [mostrarNuevo, setMostrarNuevo] = useState(false);

  const [editandoId, setEditandoId] = useState(null);
  const [edicion, setEdicion] = useState(CAMPO_VACIO);

  const [archivo, setArchivo] = useState(null);
  const [procesandoImportacion, setProcesandoImportacion] = useState(false);
  const [resultadoImportacion, setResultadoImportacion] = useState(null);

  // Combinaciones (C.O. + Proveedor) que tienen líneas en pedidos_detalle
  // pero no tienen registro en este maestro -- sin ese registro, el sistema
  // asume 0 días de entrega esperados y esas líneas suelen quedar marcadas
  // como incumplidas aunque en realidad nunca se evaluó bien su tiempo de
  // entrega. Se muestran ordenadas por líneas incumplidas y valor, para
  // priorizar cuáles registrar primero.
  const [faltantes, setFaltantes] = useState([]);
  const [cargandoFaltantes, setCargandoFaltantes] = useState(true);

  async function cargar() {
    setCargando(true);
    const { data, error } = await supabase
      .from('tiempo_entrega')
      .select('*')
      .order('co')
      .order('proveedor');
    if (error) setError(error.message);
    setRegistros(data || []);
    setCargando(false);
  }

  async function cargarFaltantes() {
    setCargandoFaltantes(true);
    const { data, error } = await supabase.rpc('get_co_proveedor_sin_tiempo_entrega');
    if (error) setError(error.message);
    setFaltantes(data || []);
    setCargandoFaltantes(false);
  }

  useEffect(() => {
    cargar();
    cargarFaltantes();
  }, []);

  // Precarga el formulario "+ Agregar proveedor" con el C.O. y Proveedor de
  // una combinación detectada como faltante, para completar rápido los
  // demás datos (días de entrega, etc.) sin tener que digitarlos de cero.
  // Si el backend ya calculó un "días de entrega sugerido" (promedio de
  // días hábiles reales entre fecha de orden y fecha de entrega real de
  // las líneas existentes de esa combinación, excluyendo 0 y 1 por poco
  // confiables), se precarga también como punto de partida -- la persona
  // puede modificarlo libremente antes de guardar si no le parece real.
  function agregarDesdeFaltante(f) {
    setNuevo({
      ...CAMPO_VACIO,
      co: f.co,
      proveedor: f.proveedor,
      dias_entrega: f.dias_entrega_sugerido != null ? String(f.dias_entrega_sugerido) : '',
    });
    setMostrarNuevo(true);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function crear(e) {
    e.preventDefault();
    setError('');
    if (!nuevo.co.trim() || !nuevo.proveedor.trim()) {
      setError('C.O. y Proveedor son obligatorios.');
      return;
    }
    const { error } = await supabase.from('tiempo_entrega').insert(aRegistro(nuevo));
    if (error) {
      setError(error.message.includes('tiempo_entrega_unico') ? 'Ya existe un registro con ese C.O. + Proveedor.' : error.message);
      return;
    }
    setNuevo(CAMPO_VACIO);
    setMostrarNuevo(false);
    cargar();
    cargarFaltantes();
  }

  function iniciarEdicion(r) {
    setEditandoId(r.id);
    setEdicion({
      co: r.co ?? '',
      proveedor: r.proveedor ?? '',
      tipo_entrega: r.tipo_entrega ?? '',
      dias_entrega: r.dias_entrega ?? '',
      nit: r.nit ?? '',
      condicion_pago: r.condicion_pago ?? '',
      sucursal: r.sucursal ?? '',
      pedido_minimo_valor: r.pedido_minimo_valor ?? '',
      pedido_minimo_peso: r.pedido_minimo_peso ?? '',
      pedido_minimo_volumen: r.pedido_minimo_volumen ?? '',
      pedido_minimo_cajas: r.pedido_minimo_cajas ?? '',
      pedido_minimo_unidades: r.pedido_minimo_unidades ?? '',
    });
  }

  async function guardarEdicion(id) {
    setError('');
    const { error } = await supabase.from('tiempo_entrega').update(aRegistro(edicion)).eq('id', id);
    if (error) {
      setError(error.message.includes('tiempo_entrega_unico') ? 'Ya existe un registro con ese C.O. + Proveedor.' : error.message);
      return;
    }
    setEditandoId(null);
    cargar();
  }

  async function eliminar(id) {
    if (!window.confirm('¿Eliminar este proveedor del maestro de tiempo de entrega?')) return;
    setError('');
    const { error } = await supabase.from('tiempo_entrega').delete().eq('id', id);
    if (error) setError(error.message);
    else { cargar(); cargarFaltantes(); }
  }

  // Carga inicial / masiva desde el Excel del indicador NS Proveedores1.
  // A diferencia de la importación de BASE/EA/ODC, esto es un UPSERT por
  // C.O. + Proveedor -- si el proveedor ya existe se actualizan sus datos,
  // si no existe se crea. Nunca borra lo que ya esté cargado (es un
  // maestro, no una carga periódica).
  async function importarArchivo() {
    if (!archivo) return;
    setProcesandoImportacion(true);
    setResultadoImportacion(null);
    try {
      const filasCrudas = await leerArchivo(archivo);
      const { filas, erroresFilas } = mapearFilasTiempoEntrega(filasCrudas);
      const omitidosDetalle = erroresFilas.map((e) => ({ motivo: e.error, fila: e.fila, ...e }));

      const porClave = new Map();
      for (const fila of filas) porClave.set(`${fila.co}||${fila.proveedor}`, fila);
      const filasUnicas = [...porClave.values()];

      let procesados = 0;
      const TAMANO_LOTE = 500;
      for (let i = 0; i < filasUnicas.length; i += TAMANO_LOTE) {
        const lote = filasUnicas.slice(i, i + TAMANO_LOTE).map((f) => ({ ...f, archivo_origen: archivo.name }));
        const { error } = await supabase.from('tiempo_entrega').upsert(lote, { onConflict: 'co,proveedor' });
        if (error) {
          for (const fila of lote) {
            const { error: errFila } = await supabase.from('tiempo_entrega').upsert([fila], { onConflict: 'co,proveedor' });
            if (errFila) omitidosDetalle.push({ motivo: `Error al guardar: ${errFila.message}`, ...fila });
            else procesados++;
          }
        } else {
          procesados += lote.length;
        }
      }

      setResultadoImportacion({ totales: filasCrudas.length, procesados, omitidosDetalle });
      setArchivo(null);
      cargar();
      cargarFaltantes();
    } catch (e) {
      setResultadoImportacion({ totales: 0, procesados: 0, omitidosDetalle: [{ fila: '-', motivo: e.message }] });
    } finally {
      setProcesandoImportacion(false);
    }
  }

  const registrosFiltrados = registros.filter((r) => {
    if (!busqueda.trim()) return true;
    const b = busqueda.trim().toLowerCase();
    return (r.co || '').toLowerCase().includes(b) || (r.proveedor || '').toLowerCase().includes(b);
  });

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="configuracion_tiempo_entrega">
      <h2>Tiempo de entrega por proveedor</h2>
      <p style={{ opacity: 0.8, maxWidth: 760 }}>
        Maestro editable (igual que en tu Excel del indicador NS Proveedores1): agrega proveedores
        nuevos o modifica los días de entrega esperados y demás datos de un proveedor ya existente.
        Se usa para calcular la <b>diferencia</b> (días hábiles reales vs. esperados) en Nivel de
        servicio. Los "días hábiles" excluyen sábados, domingos y los festivos oficiales de
        Colombia, para que la métrica de incumplimiento refleje el tiempo de entrega real.
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="panel-dashboard" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>
          Proveedores/C.O. sin tiempo de entrega definido
          {!cargandoFaltantes && faltantes.length > 0 && (
            <span className="celda-roja-metal" style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 3, fontSize: 13 }}>
              {faltantes.length}
            </span>
          )}
        </h3>
        <p style={{ fontSize: 11, opacity: 0.8, maxWidth: 900 }}>
          Estas combinaciones de C.O. + Proveedor tienen líneas en el sistema pero <b>no
          tienen un registro aquí abajo</b>: al no saber cuántos días de entrega se esperan,
          el sistema asume 0 días, así que casi todas esas líneas terminan marcadas como
          <b> incumplidas</b> aunque en realidad nunca se evaluó bien su tiempo de entrega.
          Regístralas (botón "Agregar") con sus días de entrega reales para que la métrica de
          incumplimiento sea confiable. Ordenado por líneas incumplidas y valor en riesgo.
          Cuando ya hay suficientes líneas con fecha de orden y fecha de entrega real, se
          calcula un <b>"Días sugerido"</b> (promedio de días hábiles reales, sin contar
          fines de semana ni festivos colombianos) que se precarga en el formulario al
          presionar "Agregar" — revísalo y ajústalo si no te parece representativo antes
          de guardar.
        </p>
        {cargandoFaltantes ? (
          <p style={{ fontSize: 12, opacity: 0.7 }}>Cargando...</p>
        ) : faltantes.length === 0 ? (
          <p style={{ fontSize: 12 }} className="ok-text">Todas las combinaciones C.O. + Proveedor con pedidos tienen tiempo de entrega definido.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>C.O.</th>
                  <th>Proveedor</th>
                  <th>Líneas</th>
                  <th>Líneas incumplidas</th>
                  <th>Valor bruto</th>
                  <th>Valor pendiente</th>
                  <th>Primera orden</th>
                  <th>Última orden</th>
                  <th>Días sugerido</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {faltantes.map((f) => (
                  <tr key={`${f.co}||${f.proveedor}`} className={f.lineas_incumplidas > 0 ? 'celda-roja-metal' : ''}>
                    <td>{f.co}</td>
                    <td>{f.proveedor}</td>
                    <td>{f.lineas}</td>
                    <td>{f.lineas_incumplidas}</td>
                    <td>$ {Number(f.valor_bruto || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}</td>
                    <td>$ {Number(f.valor_pendiente || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}</td>
                    <td>{f.primera_fecha_orden}</td>
                    <td>{f.ultima_fecha_orden}</td>
                    <td>{f.dias_entrega_sugerido != null ? f.dias_entrega_sugerido : '-'}</td>
                    <td><button onClick={() => agregarDesdeFaltante(f)}>Agregar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel-dashboard" style={{ maxWidth: 760, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Carga inicial / masiva desde Excel</h3>
        <p style={{ fontSize: 11, opacity: 0.8 }}>
          Usa el mismo archivo/hoja de "Tiempo de entrega" de tu Excel NS Proveedores1. Si un
          proveedor (C.O. + Proveedor) ya existe, se <b>actualiza</b> con los datos del archivo; si no
          existe, se <b>crea</b>. Nunca se borran los proveedores que no vengan en el archivo.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setArchivo(e.target.files[0])} />
          <button onClick={importarArchivo} disabled={!archivo || procesandoImportacion}>
            {procesandoImportacion ? 'Procesando...' : 'Importar'}
          </button>
        </div>
        {resultadoImportacion && (
          <div style={{ marginTop: 10, fontSize: 12 }}>
            <p>
              Total en archivo: {resultadoImportacion.totales} ·{' '}
              <span className="ok-text">Creados/actualizados: {resultadoImportacion.procesados}</span>
              {resultadoImportacion.omitidosDetalle.length > 0 && (
                <> · <span className="error-text">Omitidos: {resultadoImportacion.omitidosDetalle.length}</span></>
              )}
            </p>
            {resultadoImportacion.omitidosDetalle.length > 0 && (
              <details>
                <summary className="error-text">Ver detalle de omitidos</summary>
                <ul>
                  {resultadoImportacion.omitidosDetalle.map((o, i) => (
                    <li key={i}>Fila {o.fila}: {o.motivo}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          placeholder="Buscar por C.O. o Proveedor..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <button onClick={() => setMostrarNuevo((v) => !v)}>
          {mostrarNuevo ? 'Cancelar' : '+ Agregar proveedor'}
        </button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{cargando ? 'Cargando...' : `${registrosFiltrados.length} de ${registros.length} registro(s)`}</span>
      </div>

      {mostrarNuevo && (
        <form onSubmit={crear} className="panel-dashboard" style={{ maxWidth: 900, marginBottom: 20, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <div>
            <label>C.O. *</label><br />
            <input required value={nuevo.co} onChange={(e) => setNuevo({ ...nuevo, co: e.target.value })} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label>Proveedor *</label><br />
            <input required value={nuevo.proveedor} onChange={(e) => setNuevo({ ...nuevo, proveedor: e.target.value })} />
          </div>
          <div>
            <label>Tipo de entrega</label><br />
            <input value={nuevo.tipo_entrega} onChange={(e) => setNuevo({ ...nuevo, tipo_entrega: e.target.value })} />
          </div>
          <div>
            <label>Días de entrega</label><br />
            <input type="number" step="1" value={nuevo.dias_entrega} onChange={(e) => setNuevo({ ...nuevo, dias_entrega: e.target.value })} />
          </div>
          <div>
            <label>NIT</label><br />
            <input value={nuevo.nit} onChange={(e) => setNuevo({ ...nuevo, nit: e.target.value })} />
          </div>
          <div>
            <label>Condición de pago</label><br />
            <input value={nuevo.condicion_pago} onChange={(e) => setNuevo({ ...nuevo, condicion_pago: e.target.value })} />
          </div>
          <div>
            <label>Sucursal</label><br />
            <input value={nuevo.sucursal} onChange={(e) => setNuevo({ ...nuevo, sucursal: e.target.value })} />
          </div>
          <div>
            <label>Pedido mínimo (valor)</label><br />
            <input type="number" step="any" value={nuevo.pedido_minimo_valor} onChange={(e) => setNuevo({ ...nuevo, pedido_minimo_valor: e.target.value })} />
          </div>
          <div>
            <label>Pedido mínimo (peso)</label><br />
            <input type="number" step="any" value={nuevo.pedido_minimo_peso} onChange={(e) => setNuevo({ ...nuevo, pedido_minimo_peso: e.target.value })} />
          </div>
          <div>
            <label>Pedido mínimo (volumen)</label><br />
            <input type="number" step="any" value={nuevo.pedido_minimo_volumen} onChange={(e) => setNuevo({ ...nuevo, pedido_minimo_volumen: e.target.value })} />
          </div>
          <div>
            <label>Pedido mínimo (cajas)</label><br />
            <input type="number" step="any" value={nuevo.pedido_minimo_cajas} onChange={(e) => setNuevo({ ...nuevo, pedido_minimo_cajas: e.target.value })} />
          </div>
          <div>
            <label>Pedido mínimo (unidades)</label><br />
            <input type="number" step="any" value={nuevo.pedido_minimo_unidades} onChange={(e) => setNuevo({ ...nuevo, pedido_minimo_unidades: e.target.value })} />
          </div>
          <div style={{ gridColumn: 'span 4', display: 'flex', gap: 8 }}>
            <button type="submit">Guardar proveedor</button>
          </div>
        </form>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>C.O.</th>
              <th>Proveedor</th>
              <th>Tipo entrega</th>
              <th>Días entrega</th>
              <th>NIT</th>
              <th>Condición pago</th>
              <th>Sucursal</th>
              <th>Pedido mín. valor</th>
              <th>Pedido mín. peso</th>
              <th>Pedido mín. vol.</th>
              <th>Pedido mín. cajas</th>
              <th>Pedido mín. und.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {registrosFiltrados.map((r) => (
              <tr key={r.id}>
                {editandoId === r.id ? (
                  <>
                    <td><input style={{ width: 60 }} value={edicion.co} onChange={(e) => setEdicion({ ...edicion, co: e.target.value })} /></td>
                    <td><input style={{ width: 160 }} value={edicion.proveedor} onChange={(e) => setEdicion({ ...edicion, proveedor: e.target.value })} /></td>
                    <td><input style={{ width: 90 }} value={edicion.tipo_entrega} onChange={(e) => setEdicion({ ...edicion, tipo_entrega: e.target.value })} /></td>
                    <td><input style={{ width: 60 }} type="number" value={edicion.dias_entrega} onChange={(e) => setEdicion({ ...edicion, dias_entrega: e.target.value })} /></td>
                    <td><input style={{ width: 90 }} value={edicion.nit} onChange={(e) => setEdicion({ ...edicion, nit: e.target.value })} /></td>
                    <td><input style={{ width: 100 }} value={edicion.condicion_pago} onChange={(e) => setEdicion({ ...edicion, condicion_pago: e.target.value })} /></td>
                    <td><input style={{ width: 90 }} value={edicion.sucursal} onChange={(e) => setEdicion({ ...edicion, sucursal: e.target.value })} /></td>
                    <td><input style={{ width: 90 }} type="number" value={edicion.pedido_minimo_valor} onChange={(e) => setEdicion({ ...edicion, pedido_minimo_valor: e.target.value })} /></td>
                    <td><input style={{ width: 90 }} type="number" value={edicion.pedido_minimo_peso} onChange={(e) => setEdicion({ ...edicion, pedido_minimo_peso: e.target.value })} /></td>
                    <td><input style={{ width: 90 }} type="number" value={edicion.pedido_minimo_volumen} onChange={(e) => setEdicion({ ...edicion, pedido_minimo_volumen: e.target.value })} /></td>
                    <td><input style={{ width: 90 }} type="number" value={edicion.pedido_minimo_cajas} onChange={(e) => setEdicion({ ...edicion, pedido_minimo_cajas: e.target.value })} /></td>
                    <td><input style={{ width: 90 }} type="number" value={edicion.pedido_minimo_unidades} onChange={(e) => setEdicion({ ...edicion, pedido_minimo_unidades: e.target.value })} /></td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => guardarEdicion(r.id)}>Guardar</button>
                      <button onClick={() => setEditandoId(null)}>Cancelar</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{r.co}</td>
                    <td>{r.proveedor}</td>
                    <td>{r.tipo_entrega || '-'}</td>
                    <td>{r.dias_entrega}</td>
                    <td>{r.nit || '-'}</td>
                    <td>{r.condicion_pago || '-'}</td>
                    <td>{r.sucursal || '-'}</td>
                    <td>{r.pedido_minimo_valor ?? '-'}</td>
                    <td>{r.pedido_minimo_peso ?? '-'}</td>
                    <td>{r.pedido_minimo_volumen ?? '-'}</td>
                    <td>{r.pedido_minimo_cajas ?? '-'}</td>
                    <td>{r.pedido_minimo_unidades ?? '-'}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => iniciarEdicion(r)}>Modificar</button>
                      <button onClick={() => eliminar(r.id)}>Eliminar</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {registrosFiltrados.length === 0 && !cargando && (
              <tr><td colSpan={13} style={{ textAlign: 'center', opacity: 0.7 }}>Sin registros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
