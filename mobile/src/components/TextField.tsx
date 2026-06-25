import { forwardRef, useMemo, useState, type ReactNode } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radii, typography, type ColorPalette } from "../theme";

interface TextFieldProps extends TextInputProps {
  /** Leading icon name (Ionicons). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Trailing slot — e.g. a show/hide-password button. */
  rightSlot?: ReactNode;
  error?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Shared editorial text field with a real focus state — the active field's
 * border (and leading icon) turn brand-green, so the signature #0E5238 finally
 * appears on the most-touched surface. Replaces the hand-rolled `inputWrap`
 * pattern duplicated across auth / join-class / problem-input / practice.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { icon, rightSlot, error, containerStyle, style, onFocus, onBlur, ...props },
  ref,
) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);
  const iconColor = error ? colors.error : focused ? colors.primary : colors.textMuted;

  return (
    <View
      style={[
        styles.wrap,
        focused && styles.wrapFocused,
        error && styles.wrapError,
        containerStyle,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={iconColor} style={styles.icon} /> : null}
      <TextInput
        ref={ref}
        style={[styles.input, style]}
        placeholderTextColor={colors.textMuted}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...props}
      />
      {rightSlot}
    </View>
  );
});

const makeStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    wrap: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      backgroundColor: colors.inputBg,
    },
    // Color-only change (no borderWidth shift) keeps the field from jumping on focus.
    wrapFocused: { borderColor: colors.primary },
    wrapError: { borderColor: colors.error },
    icon: { marginLeft: 14 },
    input: {
      flex: 1,
      paddingHorizontal: 14,
      paddingVertical: 16,
      ...typography.body,
      lineHeight: 22,
      color: colors.text,
      includeFontPadding: false,
    },
  });
