import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Error atrapado por ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, maxWidth: 700 }}>
          <h2 className="error-text">Ocurrió un error mostrando esta página</h2>
          <p>
            Esto puede pasar si falta ejecutar alguna migración de base de datos, o si
            los filtros seleccionados no tienen datos. Detalle técnico:
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', border: '1px solid #999', borderRadius: 6, padding: 10 }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button onClick={() => this.setState({ error: null })}>Reintentar</button>
        </div>
      );
    }
    return this.props.children;
  }
}
