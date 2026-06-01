import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors, typography } from "../theme";

export interface CompletionRewardRef {
  fire: (intense?: boolean) => void;
}

/**
 * Quiet editorial reward that replaces the old confetti cannon on
 * session completion. A serif italic phrase fades in, holds, fades out
 * over the whole screen. Same `fire(intense?)` API as ConfettiOverlay
 * so callers can swap without other changes; `intense` swaps in a
 * stronger phrase (perfect-score moments only).
 */
export const CompletionReward = forwardRef<CompletionRewardRef>((_props, ref) => {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const [phrase, setPhrase] = useState<string>("Well done.");
  const [visible, setVisible] = useState(false);

  useImperativeHandle(ref, () => ({
    fire: (intense = false) => {
      setPhrase(intense ? "Brilliant." : "Well done.");
      setVisible(true);
      opacity.setValue(0);
      scale.setValue(0.92);
      Animated.sequence([
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 700,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(1200),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 600,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => setVisible(false));
    },
  }));

  if (!visible) return null;

  return (
    <View pointerEvents="none" style={styles.overlay}>
      <Animated.Text
        style={[
          styles.phrase,
          { color: colors.text, opacity, transform: [{ scale }] },
        ]}
      >
        {phrase}
      </Animated.Text>
    </View>
  );
});

CompletionReward.displayName = "CompletionReward";

const styles = StyleSheet.create({
  // High zIndex (iOS) and elevation (Android) win against any sibling card
  // that paints later or carries its own native elevation (shadows.md/lg).
  // Without these the reward phrase sat *under* score cards on the summary
  // screens where it's mounted as an early sibling.
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
    elevation: 9999,
  },
  phrase: {
    ...typography.displaySerifItalic,
    fontSize: 56,
    lineHeight: 60,
    textAlign: "center",
  },
});
