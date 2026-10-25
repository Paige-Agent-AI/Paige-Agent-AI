import React, {Component, type ReactNode} from "react";
import {hasUnsavedWork, useHasUnsavedWork} from "@/hooks/useBeforeUnloadGuard";
import "./page-load-boundary.css";

/** No account, error detail or destination is inferred from a failed download. */
export function PageLoadFailure({reload = () => window.location.reload()}: {reload?: () => void}) {
  const pendingWork = useHasUnsavedWork();
  return (
    <section className="page-load-failure" role="alert" aria-labelledby="page-load-heading">
      <div className="page-load-failure__content">
        <h1 id="page-load-heading">This page couldn’t open</h1>
        <p>Check your connection, then reload this page to try again.</p>
        <button type="button" disabled={pendingWork} onClick={() => {
          // Recheck the original registry at the action boundary, too.
          if (!hasUnsavedWork()) reload();
        }}>Reload page</button>
        {pendingWork && <p className="page-load-failure__pending" role="status">Finish or save your other work before reloading.</p>}
      </div>
    </section>
  );
}

/** Preserve providers/navigation outside this route; failure never becomes a blank root. */
export class PageLoadBoundary extends Component<{children: ReactNode; resetKey?: string}, {failed: boolean; resetKey?: string}> {
  state = {failed: false, resetKey: this.props.resetKey};
  static getDerivedStateFromProps(props: {resetKey?: string}, state: {resetKey?: string}) {
    // A new destination may recover a FAILED screen. A React key here would
    // also remount healthy shared children and discard their in-progress work.
    return props.resetKey !== state.resetKey ? {failed: false, resetKey: props.resetKey} : null;
  }
  static getDerivedStateFromError() { return {failed: true}; }
  render() { return this.state.failed ? <PageLoadFailure /> : this.props.children; }
}
