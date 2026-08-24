"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "@/lib/report-error";
import { PageErrorState } from "./page-error-state";

interface Props {
  children: ReactNode;
  /** Friendly, user-safe fallback copy. Never surface raw exception text —
   *  this renders where students and teachers can see it. */
  message?: string;
  title?: string;
  retryLabel?: string;
  /** Runs on retry, alongside clearing the caught error — e.g. to refetch
   *  the data whose bad shape triggered the throw. */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
}

/**
 * Reusable React error boundary. A render throw below it (malformed
 * payload, unexpected null, bad figure) is caught here and swapped for the
 * branded {@link PageErrorState} with a retry, instead of unmounting the
 * subtree to a blank screen. Retry clears the error and re-renders the
 * children in place — no full reload. Mirrors the mobile ErrorBoundary.
 *
 * To reset on an external change (e.g. a tab switch), give it a React
 * `key` that changes with that value — a new key remounts the boundary
 * and clears any latched error.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== "production") {
      console.error(error, info.componentStack);
    }
    // Ship it. Previously this branch was the whole handler, so in
    // production every render crash was discarded — the user got a retry
    // card and we got nothing. The component stack is the valuable half:
    // a minified JS stack rarely names the broken component, and this
    // does.
    reportClientError({
      kind: "render",
      message: error.message || String(error),
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  reset = () => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <PageErrorState
          title={this.props.title}
          message={
            this.props.message ??
            "Something on this page ran into an unexpected error. Try again — if it keeps happening, reload the page."
          }
          onRetry={this.reset}
          retryLabel={this.props.retryLabel}
        />
      );
    }
    return this.props.children;
  }
}
