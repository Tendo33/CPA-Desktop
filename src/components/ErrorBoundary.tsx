import { Component, type ReactNode } from 'react'
import { reportFrontendError } from '@/lib/tauri'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    reportFrontendError(error.message, error.stack ?? info.componentStack ?? undefined).catch(
      () => {},
    )
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: 'var(--c-bg)',
            color: 'var(--c-text-1)',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Something went wrong.</h2>
          <pre
            className="selectable"
            style={{
              fontSize: 12,
              color: 'var(--c-err)',
              whiteSpace: 'pre-wrap',
              padding: 12,
              background: 'var(--c-err-bg)',
              borderRadius: 6,
              maxHeight: '60vh',
              overflow: 'auto',
            }}
          >
            {this.state.error.message}
            {'\n'}
            {this.state.error.stack}
          </pre>
          <button
            className="btn btn-primary"
            onClick={() => this.setState({ error: null })}
            style={{
              alignSelf: 'flex-start',
              padding: '6px 14px',
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid var(--c-accent-dim)',
              background: 'var(--c-accent-bg)',
              color: 'var(--c-accent)',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
