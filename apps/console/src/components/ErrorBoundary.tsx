import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Catches rendering errors and shows a fallback UI instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="h-dvh flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="text-red-400 text-lg font-semibold mb-2">页面渲染异常</div>
            <div className="text-zinc-500 text-xs mb-4 font-mono break-all">
              {this.state.error?.message}
            </div>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="text-xs font-medium px-4 py-2 rounded-md bg-white/[0.08] text-zinc-300 hover:bg-white/[0.12] transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
