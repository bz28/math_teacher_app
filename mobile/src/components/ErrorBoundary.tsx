import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Sentry from "@sentry/react-native";
import { colors, spacing, typography, radii } from "../theme";

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The app ran into an unexpected error. Please try again.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => {
              this.setState({ hasError: false });
              this.props.onReset?.();
            }}
          >
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.title,
    marginBottom: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
  },
  buttonText: {
    ...typography.button,
    color: "#fff",
  },
});
