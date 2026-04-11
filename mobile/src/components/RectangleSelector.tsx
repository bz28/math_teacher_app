import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { GradientButton } from "./GradientButton";
import { AnimatedPressable } from "./AnimatedPressable";
import { useColors, spacing, radii, typography, shadows, gradients, type ColorPalette } from "../theme";

export interface Rectangle {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RectangleSelectorProps {
  imageUri: string;
  imageDimensions: { width: number; height: number };
  onConfirm: (rectangles: Rectangle[]) => void;
  onCancel: () => void;
  maxRectangles?: number;
}

const MIN_SIZE = 30;
const HANDLE_RADIUS = 20;
const HANDLE_SIZE = 14;
// RECT_COLOR and RECT_BORDER moved inside makeStyles (derived from dynamic colors)
const TOAST_DURATION = 1800;

type InteractionMode =
  | { type: "draw"; startX: number; startY: number; currentX: number; currentY: number }
  | { type: "move"; rectId: number; startX: number; startY: number; origRect: Rectangle }
  | { type: "resize"; rectId: number; corner: Corner; startX: number; startY: number; origRect: Rectangle };

type Corner = "tl" | "tr" | "bl" | "br";

export function RectangleSelector({
  imageUri,
  imageDimensions,
  onConfirm,
  onCancel,
  maxRectangles = 10,
}: RectangleSelectorProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [rectangles, setRectangles] = useState<Rectangle[]>([]);
  const [interaction, setInteraction] = useState<InteractionMode | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const nextId = useRef(1);
  const toastTimeout = useRef<ReturnType<typeof setTimeout>>(null);
  /**
   * Container's absolute position on screen, captured via measure() onLayout.
   * We use pageX/pageY (absolute screen coords) minus this offset to get
   * container-relative coordinates. nativeEvent.locationX/Y can't be used
   * here because they're relative to the touched child element, not the
   * container — touching an existing rectangle returns coords relative to
   * that rectangle, breaking hit-testing and resize as soon as any rect
   * exists.
   */
  const containerOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<View>(null);
  const measureContainer = useCallback(() => {
    containerRef.current?.measure((_x, _y, _w, _h, pageX, pageY) => {
      containerOffset.current = { x: pageX, y: pageY };
    });
  }, []);

  // Animations
  const onboardingOpacity = useRef(new Animated.Value(1)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;

  // Auto-dismiss onboarding the moment the user starts drawing or has rectangles
  useEffect(() => {
    const drawing = interaction?.type === "draw";
    if ((drawing || rectangles.length > 0) && showOnboarding) {
      Animated.timing(onboardingOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setShowOnboarding(false));
    }
  }, [interaction?.type, rectangles.length, showOnboarding, onboardingOpacity]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(TOAST_DURATION - 400),
      Animated.timing(toastOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setToast(null));
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
  }, []);

  // Image layout
  const screenWidth = Dimensions.get("window").width;
  const screenHeight = Dimensions.get("window").height - insets.top - insets.bottom - 140;
  const imgAspect = imageDimensions.width / imageDimensions.height;
  const containerAspect = screenWidth / screenHeight;
  let displayWidth: number;
  let displayHeight: number;
  if (imgAspect > containerAspect) {
    displayWidth = screenWidth;
    displayHeight = screenWidth / imgAspect;
  } else {
    displayHeight = screenHeight;
    displayWidth = screenHeight * imgAspect;
  }
  const offsetX = (screenWidth - displayWidth) / 2;
  const offsetY = (screenHeight - displayHeight) / 2;
  const scaleX = imageDimensions.width / displayWidth;
  const scaleY = imageDimensions.height / displayHeight;

  const toImageSpace = useCallback(
    (dx: number, dy: number) => ({
      x: Math.round(Math.max(0, Math.min((dx - offsetX) * scaleX, imageDimensions.width))),
      y: Math.round(Math.max(0, Math.min((dy - offsetY) * scaleY, imageDimensions.height))),
    }),
    [offsetX, offsetY, scaleX, scaleY, imageDimensions.width, imageDimensions.height],
  );

  const toDisplaySpace = useCallback(
    (ix: number, iy: number, iw: number, ih: number) => ({
      left: ix / scaleX + offsetX,
      top: iy / scaleY + offsetY,
      width: iw / scaleX,
      height: ih / scaleY,
    }),
    [scaleX, scaleY, offsetX, offsetY],
  );

  // Refs for PanResponder access
  const rectsRef = useRef(rectangles);
  rectsRef.current = rectangles;
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;

  const hitTestCorner = useCallback(
    (tx: number, ty: number): { rectId: number; corner: Corner } | null => {
      for (const r of rectsRef.current) {
        const d = toDisplaySpace(r.x, r.y, r.width, r.height);
        const corners: [Corner, number, number][] = [
          ["tl", d.left, d.top],
          ["tr", d.left + d.width, d.top],
          ["bl", d.left, d.top + d.height],
          ["br", d.left + d.width, d.top + d.height],
        ];
        for (const [corner, cx, cy] of corners) {
          if (Math.abs(tx - cx) <= HANDLE_RADIUS && Math.abs(ty - cy) <= HANDLE_RADIUS) {
            return { rectId: r.id, corner };
          }
        }
      }
      return null;
    },
    [toDisplaySpace],
  );

  const hitTestRect = useCallback(
    (tx: number, ty: number): number | null => {
      for (let i = rectsRef.current.length - 1; i >= 0; i--) {
        const r = rectsRef.current[i];
        const d = toDisplaySpace(r.x, r.y, r.width, r.height);
        if (tx >= d.left && tx <= d.left + d.width && ty >= d.top && ty <= d.top + d.height) {
          return r.id;
        }
      }
      return null;
    },
    [toDisplaySpace],
  );

  const clampRect = useCallback(
    (rect: Rectangle): Rectangle => ({
      ...rect,
      x: Math.max(0, Math.min(rect.x, imageDimensions.width - rect.width)),
      y: Math.max(0, Math.min(rect.y, imageDimensions.height - rect.height)),
    }),
    [imageDimensions.width, imageDimensions.height],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Don't capture — let children (the X delete button) claim
        // their own touches. The parent only takes the responder if no
        // child wants it.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const locationX = e.nativeEvent.pageX - containerOffset.current.x;
          const locationY = e.nativeEvent.pageY - containerOffset.current.y;

          const cornerHit = hitTestCorner(locationX, locationY);
          if (cornerHit) {
            const rect = rectsRef.current.find((r) => r.id === cornerHit.rectId);
            if (rect) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setInteraction({
                type: "resize",
                rectId: cornerHit.rectId,
                corner: cornerHit.corner,
                startX: locationX,
                startY: locationY,
                origRect: { ...rect },
              });
              return;
            }
          }

          const rectHit = hitTestRect(locationX, locationY);
          if (rectHit != null) {
            const rect = rectsRef.current.find((r) => r.id === rectHit);
            if (rect) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setInteraction({
                type: "move",
                rectId: rectHit,
                startX: locationX,
                startY: locationY,
                origRect: { ...rect },
              });
              return;
            }
          }

          if (rectsRef.current.length >= maxRectangles) {
            showToast(`Maximum ${maxRectangles} selections`);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            return;
          }

          setInteraction({
            type: "draw",
            startX: locationX,
            startY: locationY,
            currentX: locationX,
            currentY: locationY,
          });
        },

        onPanResponderMove: (e) => {
          const locationX = e.nativeEvent.pageX - containerOffset.current.x;
          const locationY = e.nativeEvent.pageY - containerOffset.current.y;
          const cur = interactionRef.current;
          if (!cur) return;

          if (cur.type === "draw") {
            setInteraction({ ...cur, currentX: locationX, currentY: locationY });
          } else if (cur.type === "move") {
            const dx = (locationX - cur.startX) * scaleX;
            const dy = (locationY - cur.startY) * scaleY;
            setRectangles((prev) =>
              prev.map((r) =>
                r.id === cur.rectId
                  ? clampRect({ ...r, x: cur.origRect.x + dx, y: cur.origRect.y + dy })
                  : r,
              ),
            );
          } else if (cur.type === "resize") {
            const dx = (locationX - cur.startX) * scaleX;
            const dy = (locationY - cur.startY) * scaleY;
            const o = cur.origRect;
            let x = o.x, y = o.y, w = o.width, h = o.height;

            if (cur.corner === "br") { w += dx; h += dy; }
            else if (cur.corner === "bl") { x += dx; w -= dx; h += dy; }
            else if (cur.corner === "tr") { y += dy; w += dx; h -= dy; }
            else { x += dx; y += dy; w -= dx; h -= dy; }

            if (w < MIN_SIZE) { w = MIN_SIZE; if (cur.corner === "tl" || cur.corner === "bl") x = o.x + o.width - MIN_SIZE; }
            if (h < MIN_SIZE) { h = MIN_SIZE; if (cur.corner === "tl" || cur.corner === "tr") y = o.y + o.height - MIN_SIZE; }

            x = Math.max(0, x);
            y = Math.max(0, y);
            w = Math.min(w, imageDimensions.width - x);
            h = Math.min(h, imageDimensions.height - y);

            setRectangles((prev) =>
              prev.map((r) => (r.id === cur.rectId ? { ...r, x, y, width: w, height: h } : r)),
            );
          }
        },

        onPanResponderRelease: () => {
          const cur = interactionRef.current;
          if (cur?.type === "draw") {
            const imgStart = toImageSpace(cur.startX, cur.startY);
            const imgEnd = toImageSpace(cur.currentX, cur.currentY);
            const x = Math.min(imgStart.x, imgEnd.x);
            const y = Math.min(imgStart.y, imgEnd.y);
            const width = Math.abs(imgEnd.x - imgStart.x);
            const height = Math.abs(imgEnd.y - imgStart.y);

            if (width >= MIN_SIZE && height >= MIN_SIZE) {
              setRectangles((prev) => [
                ...prev,
                { id: nextId.current++, x, y, width, height },
              ]);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } else {
              showToast("Too small — draw a larger area");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            }
          }
          setInteraction(null);
        },
      }),
    [hitTestCorner, hitTestRect, clampRect, toImageSpace, showToast, scaleX, scaleY, maxRectangles, imageDimensions.width, imageDimensions.height],
  );

  const undoLast = () => {
    setRectangles((prev) => {
      if (prev.length === 0) return prev;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return prev.slice(0, -1);
    });
  };

  const deleteRect = (id: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRectangles((prev) => prev.filter((r) => r.id !== id));
  };

  // Active drawing rectangle
  let activeDisplay: { left: number; top: number; width: number; height: number } | null = null;
  if (interaction?.type === "draw") {
    const l = Math.min(interaction.startX, interaction.currentX);
    const t = Math.min(interaction.startY, interaction.currentY);
    const w = Math.abs(interaction.currentX - interaction.startX);
    const h = Math.abs(interaction.currentY - interaction.startY);
    activeDisplay = { left: l, top: t, width: w, height: h };
  }

  const remaining = maxRectangles - rectangles.length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <LinearGradient colors={gradients.header} style={styles.header}>
        <AnimatedPressable onPress={onCancel} style={styles.headerBackBtn} scaleDown={0.9}>
          <Ionicons name="chevron-back" size={22} color={colors.white} />
        </AnimatedPressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Select Problems</Text>
          <Text style={styles.headerSubtitle}>
            {rectangles.length === 0
              ? "Draw around each problem"
              : remaining > 0
                ? `${rectangles.length} selected · ${remaining} more available`
                : `${rectangles.length} selected (max)`}
          </Text>
        </View>
        <View style={styles.headerBackBtn} />
      </LinearGradient>

      {/* Image area */}
      <View style={styles.imageArea}>
        <View
          ref={containerRef}
          onLayout={measureContainer}
          style={[styles.imageContainer, { width: screenWidth, height: screenHeight }]}
          {...panResponder.panHandlers}
        >
          <Image
            source={{ uri: imageUri }}
            style={{
              width: displayWidth,
              height: displayHeight,
              marginLeft: offsetX,
              marginTop: offsetY,
            }}
            resizeMode="contain"
          />

          {/* Dim overlay outside image bounds */}
          {offsetY > 0 && (
            <>
              <View style={[styles.dimOverlay, { top: 0, left: 0, right: 0, height: offsetY }]} />
              <View style={[styles.dimOverlay, { bottom: 0, left: 0, right: 0, height: offsetY }]} />
            </>
          )}
          {offsetX > 0 && (
            <>
              <View style={[styles.dimOverlay, { top: offsetY, left: 0, width: offsetX, bottom: offsetY }]} />
              <View style={[styles.dimOverlay, { top: offsetY, right: 0, width: offsetX, bottom: offsetY }]} />
            </>
          )}

          {/* Finalized rectangles */}
          {rectangles.map((r, i) => {
            const d = toDisplaySpace(r.x, r.y, r.width, r.height);
            const isActive =
              interaction?.type !== "draw" &&
              interaction != null &&
              "rectId" in interaction &&
              interaction.rectId === r.id;
            return (
              <View
                key={r.id}
                style={[
                  styles.rect,
                  { left: d.left, top: d.top, width: d.width, height: d.height },
                  isActive && styles.rectActive,
                ]}
              >
                <View style={styles.rectLabel}>
                  <Text style={styles.rectLabelText}>{i + 1}</Text>
                </View>
                <AnimatedPressable
                  style={styles.rectDelete}
                  onPress={() => deleteRect(r.id)}
                  scaleDown={0.85}
                >
                  <Ionicons name="close" size={10} color={colors.white} />
                </AnimatedPressable>
                <View style={[styles.handle, styles.handleTL]} />
                <View style={[styles.handle, styles.handleTR]} />
                <View style={[styles.handle, styles.handleBL]} />
                <View style={[styles.handle, styles.handleBR]} />
              </View>
            );
          })}

          {/* Active drawing rectangle */}
          {activeDisplay && (
            <View
              style={[
                styles.rect,
                styles.rectDrawing,
                {
                  left: activeDisplay.left,
                  top: activeDisplay.top,
                  width: activeDisplay.width,
                  height: activeDisplay.height,
                },
              ]}
            />
          )}

          {/* Onboarding overlay */}
          {showOnboarding && rectangles.length === 0 && (
            <Animated.View
              style={[styles.onboarding, { opacity: onboardingOpacity }]}
              pointerEvents="none"
            >
              <View style={styles.onboardingCard}>
                <Ionicons name="finger-print-outline" size={28} color={colors.primary} />
                <Text style={styles.onboardingTitle}>Draw to select</Text>
                <Text style={styles.onboardingDesc}>
                  Drag your finger to draw a rectangle{"\n"}around each problem you want to extract
                </Text>
              </View>
            </Animated.View>
          )}

          {/* Toast */}
          {toast && (
            <Animated.View style={[styles.toast, { opacity: toastOpacity }]} pointerEvents="none">
              <Text style={styles.toastText}>{toast}</Text>
            </Animated.View>
          )}
        </View>
      </View>

      {/* Bottom toolbar */}
      <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {/* Undo / Clear row */}
        {rectangles.length > 0 && (
          <View style={styles.toolbarActions}>
            <AnimatedPressable style={styles.toolbarBtn} onPress={undoLast} scaleDown={0.92}>
              <Ionicons name="arrow-undo-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.toolbarBtnText}>Undo</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={styles.toolbarBtn}
              onPress={() => {
                setRectangles([]);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              scaleDown={0.92}
            >
              <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.toolbarBtnText}>Clear All</Text>
            </AnimatedPressable>
          </View>
        )}

        {/* Extract button */}
        <GradientButton
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onConfirm(rectangles);
          }}
          label={
            rectangles.length === 0
              ? "Select problems to extract"
              : `Extract ${rectangles.length} Problem${rectangles.length !== 1 ? "s" : ""}`
          }
          disabled={rectangles.length === 0}
          style={styles.extractButton}
        />
      </View>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundDark,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.xl,
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    ...typography.bodyBold,
    color: colors.white,
    fontSize: 17,
  },
  headerSubtitle: {
    ...typography.caption,
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
  },

  // Image area
  imageArea: {
    flex: 1,
    backgroundColor: colors.backgroundDark,
  },
  imageContainer: {
    position: "relative",
    overflow: "hidden",
  },
  dimOverlay: {
    position: "absolute",
    backgroundColor: colors.overlayDark,
  },

  // Rectangles
  rect: {
    position: "absolute",
    backgroundColor: colors.primaryOverlay,
    borderWidth: 2,
    borderColor: colors.primaryOverlayStrong,
    borderRadius: 6,
  },
  rectDrawing: {
    borderStyle: "dashed",
  },
  rectActive: {
    borderColor: colors.primary,
    borderWidth: 2.5,
    backgroundColor: "rgba(108, 92, 231, 0.25)",
  },
  rectLabel: {
    position: "absolute",
    top: -11,
    left: -11,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.sm,
  },
  rectLabelText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.white,
  },
  rectDelete: {
    position: "absolute",
    // Sit inside the top-right corner of the rect, inset enough to
    // clear the resize handle at -7/-7. The X is on top of the
    // rect's interior and inside its frame so taps register reliably.
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.sm,
    zIndex: 10,
  },

  // Corner handles
  handle: {
    position: "absolute",
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: colors.white,
    borderWidth: 2.5,
    borderColor: colors.primary,
    ...shadows.sm,
  },
  handleTL: { top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 },
  handleTR: { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 },
  handleBL: { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 },
  handleBR: { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 },

  // Onboarding overlay
  onboarding: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  onboardingCard: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xxxl,
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.lg,
    maxWidth: 280,
  },
  onboardingTitle: {
    ...typography.heading,
    color: colors.text,
    fontSize: 18,
  },
  onboardingDesc: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },

  // Toast
  toast: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  toastText: {
    ...typography.label,
    color: colors.white,
    fontSize: 13,
  },

  // Bottom toolbar
  toolbar: {
    backgroundColor: colors.white,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    ...shadows.lg,
  },
  toolbarActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.xxl,
    marginBottom: spacing.md,
  },
  toolbarBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  toolbarBtnText: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 13,
  },
  extractButton: {
    borderRadius: radii.md,
  },
});
