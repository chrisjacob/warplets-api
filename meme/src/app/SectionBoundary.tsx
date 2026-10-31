import { Component, type ReactNode } from "react";

/** Contain failed optional modules without hiding navigation or retrying actions. */
export default class SectionBoundary extends Component<
  { label: string; children: ReactNode; onDismiss?: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="card" aria-label={this.props.label + " unavailable"}>
        <h2>{this.props.label} unavailable</h2>
        <p role="alert">Reload to try again.</p>
        <button onClick={() => location.reload()}>Reload</button>
        {this.props.onDismiss && (
          <button className="secondary" onClick={this.props.onDismiss}>
            Close
          </button>
        )}
      </section>
    );
  }
}
