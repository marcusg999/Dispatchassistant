import { Component, type ReactNode } from 'react';

/**
 * Shows what went wrong instead of a blank page. Wraps each screen (keyed on the path, so moving to
 * another screen recovers) and the whole console. The message helps whoever fixes it; it never
 * includes data from the page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; where?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="a-panel mx-auto my-6 max-w-xl p-5">
        <h1 className="text-xl font-[800] tracking-tight">This screen hit a problem</h1>
        <p className="mt-2">Nothing was lost. Try reloading. If it keeps happening, send this message to whoever looks after the app:</p>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words border border-line bg-wall p-3 text-[0.8125rem]">
          {(this.props.where ? `${this.props.where}: ` : '') + (error.name || 'Error') + ': ' + (error.message || 'unknown')}
          {'\n'}
          {navigator.userAgent}
        </pre>
        <button type="button" className="a-btn a-btn-primary mt-4" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
