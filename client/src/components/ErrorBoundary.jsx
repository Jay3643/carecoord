import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#1e3a4f' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ fontSize: 13, color: '#6b8299', marginBottom: 16 }}>{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            style={{ padding: '8px 20px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
