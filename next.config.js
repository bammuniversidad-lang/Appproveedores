/** @type {import('next').NextConfig} */

// Marcador de versión que se muestra abajo a la derecha en toda la app.
//
// Antes era solo la fecha del build ("etapa1-2026-09-07"), y eso no bastaba:
// si se despliega dos veces el mismo día se ve idéntico, así que era
// imposible saber si lo que está abierto en el navegador ya trae el último
// cambio o si es una pestaña vieja. Ahora incluye:
//   - fecha y HORA del build (cambia en cada despliegue), y
//   - los primeros 7 caracteres del commit que Vercel usó para construir.
//
// Para comprobar que estás viendo la última versión: mira el marcador de
// abajo a la derecha en la app y compáralo con lo que devuelve
// "git rev-parse --short HEAD" en tu carpeta. Si no coinciden, la pestaña
// está corriendo una versión anterior (recárgala con Ctrl+Shift+R) o el
// despliegue de Vercel todavía no terminó / falló.
const fechaBuild = new Date().toISOString().slice(0, 16).replace('T', ' ');
const commit = process.env.VERCEL_GIT_COMMIT_SHA
  ? ` · ${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)}`
  : '';

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_VERSION_APP: `etapa1-${fechaBuild} UTC${commit}`,
  },
};

module.exports = nextConfig;
