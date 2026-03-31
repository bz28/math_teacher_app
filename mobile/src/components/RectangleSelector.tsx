import { useCallback, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GradientButton } from "./GradientButton";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, radii } from "../theme";

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
const HANDLE_RADIUS = 18; // touch hit area for corner handles
const HANDLE_SIZE = 12; // visual size of corner handle dots
const RECT_COLOR = "rgba(108, 92, 231, 0.25)";
const RECT_BORDER = "rgba(108, 92, 231, 0.8)";

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
  const insets = useSafeAreaInsets();
  const [rectangles, setRectangles] = useState<Rectangle[]>([]);
  const [interaction, setInteraction] = useState<InteractionMode | null>(null);
  const nextId = useRef(1);

  // Compute displayed image size (contain mode)
  const screenWidth = Dimensions.get("window").width;
  const screenHeight = Dimensions.get("window").height - insets.top - insets.bottom - 120;
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

  // Use refs for mutable access inside PanResponder callbacks
  const rectsRef = useRef(rectangles);
  rectsRef.current = rectangles;
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;

  /** Find if touch hits a corner handle of any rectangle (returns rectId + corner). */
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

  /** Find if touch is inside any rectangle body. */
  const hitTestRect = useCallback(
    (tx: number, ty: number): number | null => {
      // Check in reverse order so topmost rect wins
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
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;

          // Priority: corner handle > rect body > draw new
          const cornerHit = hitTestCorner(locationX, locationY);
          if (cornerHit) {
            const rect = rectsRef.current.find((r) => r.id === cornerHit.rectId);
            if (rect) {
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

          // Draw new
          if (rectsRef.current.length < maxRectangles) {
            setInteraction({
              type: "draw",
              startX: locationX,
              startY: locationY,
              currentX: locationX,
              currentY: locationY,
            });
          }
        },

        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
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
            let x = o.x;
            let y = o.y;
            let w = o.width;
            let h = o.height;

            if (cur.corner === "br") { w += dx; h += dy; }
            else if (cur.corner === "bl") { x += dx; w -= dx; h += dy; }
            else if (cur.corner === "tr") { y += dy; w += dx; h -= dy; }
            else { x += dx; y += dy; w -= dx; h -= dy; } // tl

            // Enforce minimum size
            if (w < MIN_SIZE) { w = MIN_SIZE; if (cur.corner === "tl" || cur.corner === "bl") x = o.x + o.width - MIN_SIZE; }
            if (h < MIN_SIZE) { h = MIN_SIZE; if (cur.corner === "tl" || cur.corner === "tr") y = o.y + o.height - MIN_SIZE; }

            // Clamp to image bounds
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
            }
          }
          setInteraction(null);
        },
      }),
    [hitTestCorner, hitTestRect, clampRect, toImageSpace, scaleX, scaleY, maxRectangles, imageDimensions.width, imageDimensions.height],
  );

  const deleteRect = (id: number) => {
    setRectangles((prev) => prev.filter((r) => r.id !== id));
  };

  // Active drawing rectangle display coords
  let activeDisplay: { left: number; top: number; width: number; height: number } | null = null;
  if (interaction?.type === "draw") {
    const l = Math.min(interaction.startX, interaction.currentX);
    const t = Math.min(interaction.startY, interaction.currentY);
    const w = Math.abs(interaction.currentX - interaction.startX);
    const h = Math.abs(interaction.currentY - interaction.startY);
    activeDisplay = { left: l, top: t, width: w, height: h };
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Text style={s.title}>Draw rectangles around each problem</Text>
      <Text style={s.subtitle}>
        {rectangles.length}/{maxRectangles} selected · Drag to move · Corners to resize
      </Text>

      <View
        style={[s.imageContainer, { width: screenWidth, height: screenHeight }]}
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
                s.rect,
                { left: d.left, top: d.top, width: d.width, height: d.height },
                isActive && s.rectActive,
              ]}
            >
              {/* Number label */}
              <View style={s.rectLabel}>
                <Text style={s.rectLabelText}>{i + 1}</Text>
              </View>
              {/* Delete button */}
              <TouchableOpacity
                style={s.rectDelete}
                onPress={() => deleteRect(r.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.rectDeleteText}>&times;</Text>
              </TouchableOpacity>
              {/* Corner resize handles */}
              <View style={[s.handle, s.handleTL]} />
              <View style={[s.handle, s.handleTR]} />
              <View style={[s.handle, s.handleBL]} />
              <View style={[s.handle, s.handleBR]} />
            </View>
          );
        })}

        {/* Active drawing rectangle */}
        {activeDisplay && (
          <View
            style={[
              s.rect,
              {
                left: activeDisplay.left,
                top: activeDisplay.top,
                width: activeDisplay.width,
                height: activeDisplay.height,
              },
            ]}
          />
        )}
      </View>

      <View style={s.buttons}>
        <AnimatedPressable style={s.cancelButton} onPress={onCancel}>
          <Text style={s.cancelText}>Cancel</Text>
        </AnimatedPressable>
        {rectangles.length > 0 && (
          <AnimatedPressable
            style={s.clearButton}
            onPress={() => setRectangles([])}
          >
            <Text style={s.cancelText}>Clear</Text>
          </AnimatedPressable>
        )}
        <GradientButton
          onPress={() => onConfirm(rectangles)}
          label={`Extract ${rectangles.length} Problem${rectangles.length !== 1 ? "s" : ""}`}
          disabled={rectangles.length === 0}
          style={s.extractButton}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    paddingTop: spacing.md,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  imageContainer: {
    position: "relative",
    overflow: "hidden",
  },
  rect: {
    position: "absolute",
    backgroundColor: RECT_COLOR,
    borderWidth: 2,
    borderColor: RECT_BORDER,
    borderRadius: 4,
  },
  rectActive: {
    borderColor: colors.primary,
    borderWidth: 2.5,
  },
  rectLabel: {
    position: "absolute",
    top: -10,
    left: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  rectLabelText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.white,
  },
  rectDelete: {
    position: "absolute",
    top: -10,
    right: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  rectDeleteText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.white,
    lineHeight: 16,
  },
  handle: {
    position: "absolute",
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  handleTL: { top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 },
  handleTR: { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 },
  handleBL: { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 },
  handleBR: { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 },
  buttons: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
  },
  clearButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  extractButton: {
    flex: 1,
  },
});
