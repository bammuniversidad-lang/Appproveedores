import { useEffect, useState } from 'react';
import { AuthProvider } from '../lib/AuthContext';
import ErrorBoundary from '../components/ErrorBoundary';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  const [tema, setTema] = useState('tema-claro');

  useEffect(() => {
    const guardado = typeof window !== 'undefined' ? localStorage.getItem('tema') : null;
    const temaInicial = guardado || 'tema-claro';
    setTema(temaInicial);
    document.body.className = temaInicial;
  }, []);

  function alternarTema() {
    const nuevo = tema === 'tema-claro' ? 'tema-oscuro' : 'tema-claro';
    setTema(nuevo);
    document.body.className = nuevo;
    localStorage.setItem('tema', nuevo);
  }

  return (
    <AuthProvider>
      <ErrorBoundary>
        <Component {...pageProps} tema={tema} alternarTema={alternarTema} />
      </ErrorBoundary>
    </AuthProvider>
  );
}
