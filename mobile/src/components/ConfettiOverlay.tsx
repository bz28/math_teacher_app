import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Dimensions, StyleSheet } from "react-native";
import ConfettiCannon from "react-native-confetti-cannon";
import { colors } from "../theme";

const { width, height } = Dimensions.get("window");

const COLORS = [colors.primary, "#A29BFE", colors.success, colors.warning, colors.error];

export interface ConfettiOverlayRef {
  fire: (intense?: boolean) => void;
}

export const ConfettiOverlay = forwardRef<ConfettiOverlayRef>((_props, ref) => {
  const cannonRef = useRef<ConfettiCannon>(null);
  const [config, setConfig] = useState({ count: 100, key: 0 });

  useImperativeHandle(ref, () => ({
    fire: (intense = false) => {
      setConfig((prev) => ({
        count: intense ? 200 : 100,
        key: prev.key + 1,
      }));
    },
  }));

  return (
    <ConfettiCannon
      key={config.key}
      ref={cannonRef}
      count={config.count}
      origin={{ x: width / 2, y: -20 }}
      fadeOut
      autoStart
      fallSpeed={3000}
      explosionSpeed={350}
      colors={COLORS}
    />
  );
});
