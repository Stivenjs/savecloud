import React from "react";
import { ErrorScreen } from "@components/error/ErrorScreen";

interface State {
  hasError: boolean;
  error?: Error;
}

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = {
    hasError: false,
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("React ErrorBoundary:", error);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorScreen message={this.state.error?.stack} />;
    }

    return this.props.children;
  }
}
