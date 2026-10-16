import { Component, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/page/EmptyState";

/** Keep a failed departmental render inside its screen, away from navigation and PAIGE. */
export class SoloScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section role="alert" aria-label="Page unavailable">
          <EmptyState
            title="This page couldn’t open"
            description="You can keep working from the navigation."
          />
        </section>
      );
    }
    return this.props.children;
  }
}
