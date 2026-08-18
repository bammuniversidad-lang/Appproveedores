import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { supabase } from '../../lib/supabaseClient';
import { leerArchivo, normalizarEncabezado } from '../../lib/importUtils';

export default function Motivos({ tema, alternarTema }) {
  const [motivos, setMotivos] = useState([]);
  const [nombre, setNombre] = useState('');
  const [responsable, setResponsable] = useState('');
  const [error, setError] = useState('');
  const [editandoId, setEditandoId] = useState(null);
  const [edicion, setEdicion] = useState({ nombre: '', responsable: '' });

  const [archivoMotivos, setArchivoMotivos] = useState(null);
  const [procesandoImportacion, setProcesandoImportacion] = useState(false);
  const [resultadoImportacion, setResultadoImportacion] = useState(null);

  async function cargar() {
    const { data } = await supabase.from('motivos').select('*').order('nombre');
    setMotivos(data || []);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function crear(e) {
    e.preventDefault();
    setError('');
    const { error } = await supabase.from('motivos').insert({ nombre, responsable });
    if (error) {
      setError(error.message);
      return;
    }
    setNombre('');
    setResponsable('');
    cargar();
  }

  function iniciarEdicion(m) {
    setEditandoId(m.id);
    setEdicion({ nombre: m.nombre, responsable: m.responsable });
  }

  async function guardarEdicion(id) {
    setError('');
    const { error } = await supabase
      .from('motivos')
      .update({ nombre: edicion.nombre, responsable: edicion.responsable })
      .eq('id', id);
    if (error) {
      setError(error.message);
      return;
    }
    setEditandoId(null);
    cargar();
  }

  async function importarMotivos() {
    if (!archivoMotivos) return;
    setProcesandoImportacion(true);
    setResultadoImportacion(null);
    try {
      const filasCrudas = await leerArchivo(archivoMotivos);

      // Acepta encabezados "Motivo" y "Responsable" (sin importar mayúsculas/tildes).
      const filas = filasCrudas.map((filaCruda) => {
        const fila = {};
        for (const [encabezado, valor] of Object.entries(filaCruda)) {
          const clave = normalizarEncabezado(encabezado);
          if (clave === 'motivo' || clave === 'nombre') fila.nombre = valor;
          if (clave === 'responsable') fila.responsable = valor;
        }
        return fila;
      });

      const omitidos = [];
      const paraCrear = [];
      const paraActualizar = [];

      const { data: existentes } = await supabase.from('motivos').select('id,nombre,responsable');
      const mapaExistentes = new Map((existentes || []).map((m) => [m.nombre.trim().toLowerCase(), m]));
      const vistosEnArchivo = new Set();

      for (const [i, fila] of filas.entries()) {
        const nombreFila = fila.nombre ? String(fila.nombre).trim() : '';
        const responsableFila = fila.responsable ? String(fila.responsable).trim() : '';

        if (!nombreFila) {
          omitidos.push({ fila: i + 2, motivo: 'Falta el nombre del motivo' });
          continue;
        }
        if (!responsableFila) {
          omitidos.push({ fila: i + 2, motivo: `Falta el responsable para "${nombreFila}"` });
          continue;
        }

        const clave = nombreFila.toLowerCase();
        if (vistosEnArchivo.has(clave)) {
          omitidos.push({ fila: i + 2, motivo: `"${nombreFila}" está repetido dentro del archivo (se usó la primera aparición)` });
          continue;
        }
        vistosEnArchivo.add(clave);

        const existente = mapaExistentes.get(clave);
        if (existente) {
          if (existente.responsable !== responsableFila) {
            paraActualizar.push({ id: existente.id, nombre: nombreFila, responsable: responsableFila });
          }
        } else {
          paraCrear.push({ nombre: nombreFila, responsable: responsableFila });
        }
      }

      let creados = 0;
      let actualizados = 0;

      if (paraCrear.length > 0) {
        const { data, error: errCrear } = await supabase.from('motivos').insert(paraCrear).select('id');
        if (errCrear) omitidos.push({ fila: '-', motivo: `Error creando motivos nuevos: ${errCrear.message}` });
        else creados = data?.length || 0;
      }

      for (const m of paraActualizar) {
        const { error: errAct } = await supabase.from('motivos').update({ responsable: m.responsable }).eq('id', m.id);
        if (errAct) omitidos.push({ fila: '-', motivo: `Error actualizando "${m.nombre}": ${errAct.message}` });
        else actualizados++;
      }

      setResultadoImportacion({
        totales: filas.length,
        creados,
        actualizados,
        sinCambios: filas.length - creados - actualizados - omitidos.length,
        omitidos,
      });
      setArchivoMotivos(null);
      cargar();
    } catch (e) {
      setResultadoImportacion({ totales: 0, creados: 0, actualizados: 0, sinCambios: 0, omitidos: [{ fila: '-', motivo: e.message }] });
    } finally {
      setProcesandoImportacion(false);
    }
  }

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="configuracion_motivos">
      <h2>Configuración de motivos</h2>

      <form onSubmit={crear} style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
        <div>
          <label>Motivo</label><br />
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div>
          <label>Responsable</label><br />
          <input required value={responsable} onChange={(e) => setResponsable(e.target.value)} />
        </div>
        <button type="submit">Agregar</button>
      </form>

      {error && <p className="error-text">{error}</p>}

      <div className="panel-dashboard" style={{ maxWidth: 640, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Importar varios desde Excel/CSV</h3>
        <p style={{ fontSize: 11, opacity: 0.8 }}>
          El archivo debe tener las columnas <b>Motivo</b> y <b>Responsable</b>. Si un motivo ya
          existe (por nombre), se actualiza su responsable; si no existe, se crea.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setArchivoMotivos(e.target.files[0])}
          />
          <button onClick={importarMotivos} disabled={!archivoMotivos || procesandoImportacion}>
            {procesandoImportacion ? 'Procesando...' : 'Importar'}
          </button>
        </div>

        {resultadoImportacion && (
          <div style={{ marginTop: 10, fontSize: 12 }}>
            <p>
              Total en archivo: {resultadoImportacion.totales} ·{' '}
              <span className="ok-text">Creados: {resultadoImportacion.creados}</span> ·{' '}
              <span className="ok-text">Actualizados: {resultadoImportacion.actualizados}</span> ·{' '}
              Sin cambios: {resultadoImportacion.sinCambios} ·{' '}
              {resultadoImportacion.omitidos.length > 0 && (
                <span className="error-text">Omitidos: {resultadoImportacion.omitidos.length}</span>
              )}
            </p>
            {resultadoImportacion.omitidos.length > 0 && (
              <details>
                <summary className="error-text">Ver detalle de omitidos</summary>
                <ul>
                  {resultadoImportacion.omitidos.map((o, i) => (
                    <li key={i}>Fila {o.fila}: {o.motivo}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      <table style={{ maxWidth: 600 }}>
        <thead>
          <tr><th>Motivo</th><th>Responsable</th><th></th></tr>
        </thead>
        <tbody>
          {motivos.map((m) => (
            <tr key={m.id}>
              {editandoId === m.id ? (
                <>
                  <td>
                    <input value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} />
                  </td>
                  <td>
                    <input value={edicion.responsable} onChange={(e) => setEdicion({ ...edicion, responsable: e.target.value })} />
                  </td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => guardarEdicion(m.id)}>Guardar</button>
                    <button onClick={() => setEditandoId(null)}>Cancelar</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{m.nombre}</td>
                  <td>{m.responsable}</td>
                  <td><button onClick={() => iniciarEdicion(m)}>Modificar</button></td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
