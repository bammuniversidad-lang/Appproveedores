import Layout from '../components/Layout';
import { useAuth } from '../lib/AuthContext';

export default function Inicio({ tema, alternarTema }) {
  const { profile } = useAuth();

  return (
    <Layout tema={tema} alternarTema={alternarTema}>
      <h2>Bienvenido{profile ? `, ${profile.nombre_completo}` : ''}</h2>
      <p>Selecciona una opción del menú lateral para comenzar.</p>
    </Layout>
  );
}
