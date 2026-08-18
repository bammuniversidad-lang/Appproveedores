import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '../lib/AuthContext';

const OPCIONES_MENU = [
  { modulo: 'importar', etiqueta: 'Importar bases de datos', ruta: '/importar', icono: '📥' },
  { modulo: 'nivel_servicio', etiqueta: 'Nivel de servicio', ruta: '/nivel-servicio', icono: '🚚' },
  { modulo: 'novedades', etiqueta: 'Novedades por incumplimiento', ruta: '/novedades', icono: '⚠️' },
  { modulo: 'dashboard', etiqueta: 'Dashboard', ruta: '/dashboard', icono: '📊' },
];

const OPCIONES_CONFIGURACION = [
  { modulo: 'configuracion_usuarios', etiqueta: 'Usuarios', ruta: '/configuracion/usuarios' },
  { modulo: 'configuracion_motivos', etiqueta: 'Motivos', ruta: '/configuracion/motivos' },
  { modulo: 'configuracion_tiempo_entrega', etiqueta: 'Tiempo de entrega', ruta: '/configuracion/tiempo-entrega' },
  { modulo: 'configuracion_cierre_mes', etiqueta: 'Cierre de mes', ruta: '/configuracion/cierre-mes' },
];

function ItemMenu({ href, icono, children, expandido, alNavegar }) {
  const router = useRouter();
  const activo = router.pathname === href;
  return (
    <Link
      href={href}
      onClick={alNavegar}
      title={!expandido ? children : undefined}
      className={`item-menu ${activo ? 'item-menu-activo' : ''}`}
    >
      {icono && <span className="item-menu-icono">{icono}</span>}
      {expandido && <span>{children}</span>}
    </Link>
  );
}

function saludo() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function MenuAvatar({ nombre, rol, cerrarSesion }) {
  const [abierto, setAbierto] = useState(false);
  const inicial = (nombre || '?').trim().charAt(0).toUpperCase();

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setAbierto((v) => !v)}>
        <span style={{ fontSize: 12 }}>
          {saludo()} {nombre} <span style={{ opacity: 0.7 }}>({rol})</span>
        </span>
        <div className="avatar-usuario">{inicial}</div>
      </div>
      {abierto && (
        <div className="menu-avatar-desplegable">
          <button onClick={cerrarSesion}>Cerrar sesión</button>
        </div>
      )}
    </div>
  );
}

export default function Layout({ children, tema, alternarTema, requiereModulo }) {
  const { session, profile, cargando, cerrarSesion } = useAuth();
  const router = useRouter();
  const [expandido, setExpandido] = useState(true);
  const [configuracionAbierta, setConfiguracionAbierta] = useState(
    router.pathname.startsWith('/configuracion')
  );

  useEffect(() => {
    if (cargando) return;
    if (!session) {
      router.replace('/login');
      return;
    }
    if (profile && requiereModulo) {
      const permitido =
        profile.rol === 'administrador' || profile.modulos_permitidos?.includes(requiereModulo);
      if (!permitido) {
        router.replace('/');
      }
    }
  }, [cargando, session, profile, requiereModulo]);

  if (cargando || !session) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  const esAdmin = profile?.rol === 'administrador';
  const modulosVisibles = esAdmin
    ? OPCIONES_MENU
    : OPCIONES_MENU.filter((o) => profile?.modulos_permitidos?.includes(o.modulo));
  const opcionesConfigVisibles = esAdmin
    ? OPCIONES_CONFIGURACION
    : OPCIONES_CONFIGURACION.filter((o) => profile?.modulos_permitidos?.includes(o.modulo));
  const mostrarConfiguracion = opcionesConfigVisibles.length > 0;

  function alNavegar() {
    setExpandido(false);
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="barra-superior">
        <span className="titulo-app-barra">NS PROVEEDORES</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={alternarTema} title="Cambiar fondo" className="no-imprimir">
            {tema === 'tema-claro' ? '🌙 Fondo negro' : '☀ Fondo blanco'}
          </button>
          <MenuAvatar nombre={profile?.nombre_completo} rol={profile?.rol} cerrarSesion={cerrarSesion} />
        </div>
      </header>

      <div style={{ display: 'flex' }}>
        <aside
          className={`barra-lateral no-imprimir ${expandido ? 'barra-lateral-expandida' : 'barra-lateral-colapsada'}`}
          onMouseLeave={() => setExpandido(false)}
        >
          <button
            className="boton-hamburguesa"
            onClick={() => setExpandido((v) => !v)}
            title={expandido ? 'Contraer menú' : 'Expandir menú'}
          >
            ☰ {expandido && <span style={{ marginLeft: 8 }}>🚚 NS Proveedores</span>}
          </button>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
            <ItemMenu href="/" icono="🏠" expandido={expandido} alNavegar={alNavegar}>Inicio</ItemMenu>
            {modulosVisibles.map((o) => (
              <ItemMenu key={o.ruta} href={o.ruta} icono={o.icono} expandido={expandido} alNavegar={alNavegar}>
                {o.etiqueta}
              </ItemMenu>
            ))}

            {mostrarConfiguracion && (
              <>
                <button
                  className="item-menu item-menu-grupo"
                  title={!expandido ? 'Configuración' : undefined}
                  onClick={() => (expandido ? setConfiguracionAbierta((v) => !v) : setExpandido(true))}
                >
                  <span className="item-menu-icono">⚙️</span>
                  {expandido && <span>Configuración {configuracionAbierta ? '▾' : '▸'}</span>}
                </button>
                {expandido && configuracionAbierta && (
                  <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 14 }}>
                    {opcionesConfigVisibles.map((o) => (
                      <ItemMenu key={o.ruta} href={o.ruta} expandido={expandido} alNavegar={alNavegar}>
                        {o.etiqueta}
                      </ItemMenu>
                    ))}
                  </div>
                )}
              </>
            )}
          </nav>
        </aside>
        <main style={{ flexGrow: 1, padding: 20, overflowX: 'auto', overflowY: 'visible', transition: 'margin 0.2s ease' }}>
          {children}
          <p className="no-imprimir" style={{ fontSize: 9, opacity: 0.4, marginTop: 40, textAlign: 'right' }}>
            NS Proveedores · versión {process.env.NEXT_PUBLIC_VERSION_APP || 'dev'}
          </p>
        </main>
      </div>
    </div>
  );
}
