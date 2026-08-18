import { useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabaseClient';

export default function Login() {
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [recordarme, setRecordarme] = useState(true);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [recuperar, setRecuperar] = useState(false);
  const [mensajeRecuperar, setMensajeRecuperar] = useState('');
  const router = useRouter();

  async function manejarEnvio(e) {
    e.preventDefault();
    setError('');
    setCargando(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: correo,
      password,
    });

    setCargando(false);

    if (error) {
      setError('Usuario o contraseña incorrectos.');
      return;
    }

    router.push('/');
  }

  async function manejarRecuperar(e) {
    e.preventDefault();
    setMensajeRecuperar('');
    const { error } = await supabase.auth.resetPasswordForEmail(correo);
    setMensajeRecuperar(
      error ? `No se pudo enviar el correo: ${error.message}` : 'Si el correo existe, te enviamos un enlace para restablecer la contraseña.'
    );
  }

  return (
    <div className="pantalla-login">
      <div className="fondo-decorativo">
        <span className="circulo circulo-1" />
        <span className="circulo circulo-2" />
        <span className="circulo circulo-3" />
      </div>

      <h1 className="titulo-app">NS PROVEEDORES</h1>

      <div className="tarjeta-login">
        <div className="icono-login">🚚</div>

        {!recuperar ? (
          <>
            <h2>Iniciar sesión</h2>
            <p className="subtitulo-login">Bienvenido de nuevo, por favor ingresa tus datos</p>

            <form onSubmit={manejarEnvio}>
              <div style={{ marginBottom: 14 }}>
                <label>Usuario (correo)</label>
                <input
                  type="email"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  required
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ marginBottom: 8 }}>
                <label>Contraseña</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={verPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    style={{ width: '100%', paddingRight: 36 }}
                  />
                  <button
                    type="button"
                    onClick={() => setVerPassword((v) => !v)}
                    className="boton-ver-password"
                    title={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {verPassword ? '🙈' : '👁'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={recordarme} onChange={(e) => setRecordarme(e.target.checked)} />
                  Recordarme
                </label>
                <button type="button" className="enlace-simple" onClick={() => setRecuperar(true)}>
                  ¿Olvidaste tu contraseña?
                </button>
              </div>

              {error && <p className="error-text">{error}</p>}

              <button type="submit" disabled={cargando} className="boton-login-grande">
                {cargando ? 'Ingresando...' : 'Iniciar sesión'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h2>Recuperar contraseña</h2>
            <p className="subtitulo-login">Escribe tu correo y te enviaremos un enlace para restablecerla.</p>
            <form onSubmit={manejarRecuperar}>
              <div style={{ marginBottom: 14 }}>
                <label>Correo</label>
                <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required style={{ width: '100%' }} />
              </div>
              {mensajeRecuperar && <p>{mensajeRecuperar}</p>}
              <button type="submit" className="boton-login-grande">Enviar enlace</button>
              <button type="button" style={{ width: '100%', marginTop: 8 }} onClick={() => setRecuperar(false)}>
                Volver a iniciar sesión
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
