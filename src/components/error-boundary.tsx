import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() {
    return { error: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info)
  }
  render() {
    if (this.state.error)
      return (
        <main className="fatal-error">
          <h1>Something went wrong</h1>
          <button onClick={() => location.reload()}>Reload</button>
        </main>
      )
    return this.props.children
  }
}
