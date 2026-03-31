import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";

/** Fade-in + slide-up animation hook */
export function useFadeInUp(delay = 0, duration = 500) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, []);

  return { opacity, transform: [{ translateY }] };
}
