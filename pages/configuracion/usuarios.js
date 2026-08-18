import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabaseClient';

const MODULOS_DISPONIBLES = [
  { valor: 'importar', etiqueta: 'Importar bases de datos' },
  { valor: 'nivel_servicio', etiqueta: 'Nivel de servicio' },
  { valor: 'novedades', etiqueta: 'Novedades por incumplimiento' },
  { valor: 'dashboard', etiqueta: 'Dashboard' },
  { valor: 'configuracion_usuarios', etiqueta: 'Configuración > Usuarios' },
  { valor: 'configuracion_motivos', etiqueta: 'Configuración > Motivos' },
  { valor: 'configuracion_tiempo_entrega', etiqueta: 'Configuración > Tiempo de entrega' },
  { valor: 'configuracion_cierre_mes', etiqueta: 'Configuración > Cierre de mes' },
];

const VACIO = {
  id: null,
  nombre_completo: '',
  correo: '',
  celular: '',
  password: '',
  rol: 'usuario',
  ve_todos_co: false,
  cos_permitidos: [],
  modulos_permitidos: [],
};

export default function Usuarios({ tema, alternarTema }) {
  const { session } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [cosDisponibles, setCosDisponibles] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  const editando = !!form.id;

  async function cargarUsuarios() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    setUsuarios(data || []);
  }

  async function cargarCOs() {
    const { data: cosPedidos } = await supabase.from('pedidos_detalle').select('co');
    const unicos = [...new Set((cosPedidos || []).map((r) => r.co))].sort();
    setCosDisponibles(unicos);
  }

  useEffect(() => {
    cargarUsuarios();
    cargarCOs();
  }, []);

  function alternarModulo(valor) {
    setForm((f) => ({
      ...f,
      modulos_permitidos: f.modulos_permitidos.includes(valor)
        ? f.modulos_permitidos.filter((m) => m !== valor)
        : [...f.modulos_permitidos, valor],
    }));
  }

  function alternarCO(valor) {
    setForm((f) => ({
      ...f,
      cos_permitidos: f.cos_permitidos.includes(valor)
        ? f.cos_permitidos.filter((c) => c !== valor)
        : [...f.cos_permitidos, valor],
    }));
  }

  function abrirCrear() {
    setForm(VACIO);
    setMensaje('');
    setError('');
    setMostrarFormulario(true);
  }

  function abrirEditar(u) {
    setForm({
      id: u.id,
      nombre_completo: u.nombre_completo || '',
      correo: u.correo || '',
      celular: '', // en blanco a propósito: solo se cambia si se escribe algo
      password: '', // en blanco a propósito: solo se cambia si se escribe algo
      rol: u.rol,
      ve_todos_co: u.ve_todos_co,
      cos_permitidos: u.cos_permitidos || [],
      modulos_permitidos: u.modulos_permitidos || [],
      celularActual: u.celular,
    });
    setMensaje('');
    setError('');
    setMostrarFormulario(true);
  }

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setMensaje('');
    setError('');
    try {
      const ruta = editando ? '/api/actualizar-usuario' : '/api/crear-usuario';
      const cuerpo = editando
        ? { ...form, celular: form.celular || form.celularActual }
        : form;

      const respuesta = await fetch(ruta, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(cuerpo),
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) throw new Error(resultado.error || 'Error al guardar usuario');
      setMensaje(editando ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente.');
      setForm(VACIO);
      setMostrarFormulario(false);
      cargarUsuarios();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="configuracion_usuarios">
      <h2>Configuración de usuarios</h2>

      {!mostrarFormulario && (
        <div style={{ marginBottom: 16 }}>
          <button onClick={abrirCrear}>+ Crear usuario</button>
        </div>
      )}

      {mostrarFormulario && (
        <form
          onSubmit={guardar}
          autoComplete="off"
          style={{ border: '1px solid #999', borderRadius: 6, padding: 16, marginBottom: 20, maxWidth: 480 }}
        >
          <h3 style={{ marginTop: 0 }}>{editando ? 'Modificar usuario' : 'Crear nuevo usuario'}</h3>

          <div style={{ marginBottom: 8 }}>
            <label>Nombre completo</label><br />
            <input style={{ width: '100%' }} required autoComplete="off" value={form.nombre_completo}
              onChange={(e) => setForm({ ...form, nombre_completo: e.target.value })} />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label>Correo</label><br />
            <input type="email" style={{ width: '100%' }} required autoComplete="off" disabled={editando}
              value={form.correo}
              onChange={(e) => setForm({ ...form, correo: e.target.value })} />
            {editando && <small style={{ opacity: 0.7 }}>El correo no se puede cambiar desde aquí.</small>}
          </div>

          <div style={{ marginBottom: 8 }}>
            <label>Celular {editando && '(dejar en blanco para no cambiar)'}</label><br />
            <input
              style={{ width: '100%' }}
              autoComplete="off"
              name="celular-usuario-compras"
              placeholder={editando ? (form.celularActual || '') : ''}
              value={form.celular}
              onChange={(e) => setForm({ ...form, celular: e.target.value })}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label>{editando ? 'Nueva contraseña (dejar en blanco para no cambiar)' : 'Contraseña inicial'}</label><br />
            <input
              type="password"
              style={{ width: '100%' }}
              required={!editando}
              minLength={6}
              autoComplete="new-password"
              name="clave-usuario-compras"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label>Rol</label><br />
            <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}>
              <option value="usuario">Usuario</option>
              <option value="comprador">Comprador</option>
              <option value="administrador">Administrador</option>
            </select>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label>
              <input type="checkbox" checked={form.ve_todos_co}
                onChange={(e) => setForm({ ...form, ve_todos_co: e.target.checked })} />
              {' '}Ve todos los C.O.
            </label>
          </div>

          {!form.ve_todos_co && (
            <div style={{ marginBottom: 8 }}>
              <label>C.O. que puede ver</label><br />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {cosDisponibles.length === 0 && <span style={{ opacity: 0.7 }}>Aún no hay C.O. creados</span>}
                {cosDisponibles.map((co) => (
                  <label key={co} style={{ border: '1px solid #999', borderRadius: 3, padding: '2px 6px' }}>
                    <input type="checkbox" checked={form.cos_permitidos.includes(co)} onChange={() => alternarCO(co)} />
                    {' '}{co}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label>Módulos que puede ver</label><br />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {MODULOS_DISPONIBLES.map((m) => (
                <label key={m.valor} style={{ border: '1px solid #999', borderRadius: 3, padding: '2px 6px' }}>
                  <input type="checkbox" checked={form.modulos_permitidos.includes(m.valor)} onChange={() => alternarModulo(m.valor)} />
                  {' '}{m.etiqueta}
                </label>
              ))}
            </div>
          </div>

          {mensaje && <p className="ok-text">{mensaje}</p>}
          {error && <p className="error-text">{error}</p>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={guardando}>
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear usuario'}
            </button>
            <button type="button" onClick={() => { setMostrarFormulario(false); setForm(VACIO); }}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <h3>Usuarios existentes</h3>
      <table>
        <thead>
          <tr>
            <th>Nombre</th><th>Correo</th><th>Celular</th><th>Rol</th><th>C.O.</th><th>Módulos</th><th></th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id}>
              <td>{u.nombre_completo}</td>
              <td>{u.correo}</td>
              <td>{u.celular}</td>
              <td>{u.rol}</td>
              <td>{u.ve_todos_co ? 'Todos' : (u.cos_permitidos || []).join(', ')}</td>
              <td>{(u.modulos_permitidos || []).join(', ')}</td>
              <td><button onClick={() => abrirEditar(u)}>Editar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
