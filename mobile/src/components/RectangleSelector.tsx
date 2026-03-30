import { useRef, useState } from "react";
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
const RECT_COLOR = "rgba(108, 92, 231, 0.25)";
const RECT_BORDER = "rgba(108, 92, 231, 0.8)";

export function RectangleSelector({
  imageUri,
  imageDimensions,
  onConfirm,
  onCancel,
  maxRectangles = 10,
}: RectangleSelectorProps) {
  const insets = useSafeAreaInsets();
  const [rectangles, setRectangles] = useState<Rectangle[]>([]);
  const [activeRect, setActiveRect] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [displayLayout, setDisplayLayout] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const nextId = useRef(1);

  // Compute displayed image size (contain mode)
  const screenWidth = Dimensions.get("window").width;
  const screenHeight = Dimensions.get("window").height - insets.top - insets.bottom - 120; // leave room for buttons
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

  const toImageSpace = (dx: number, dy: number) => ({
    x: Math.round(Math.max(0, Math.min((dx - offsetX) * scaleX, imageDimensions.width))),
    y: Math.round(Math.max(0, Math.min((dy - offsetY) * scaleY, imageDimensions.height))),
  });

  const toDisplaySpace = (ix: number, iy: number, iw: number, ih: number) => ({
    left: ix / scaleX + offsetX,
    top: iy / scaleY + offsetY,
    width: iw / scaleX,
    height: ih / scaleY,
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        if (rectangles.length >= maxRectangles) return;
        const { locationX, locationY } = e.nativeEvent;
        setActiveRect({
          startX: locationX,
          startY: locationY,
          currentX: locationX,
          currentY: locationY,
        });
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        setActiveRect((prev) =>
          prev ? { ...prev, currentX: locationX, currentY: locationY } : null,
        );
      },
      onPanResponderRelease: () => {
        setActiveRect((cur) => {
          if (!cur) return null;
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
          return null;
        });
      },
    }),
  ).current;

  const deleteRect = (id: number) => {
    setRectangles((prev) => prev.filter((r) => r.id !== id));
  };

  // Active rectangle display coords
  let activeDisplay: { left: number; top: number; width: number; height: number } | null = null;
  if (activeRect) {
    const l = Math.min(activeRect.startX, activeRect.currentX);
    const t = Math.min(activeRect.startY, activeRect.currentY);
    const w = Math.abs(activeRect.currentX - activeRect.startX);
    const h = Math.abs(activeRect.currentY - activeRect.startY);
    activeDisplay = { left: l, top: t, width: w, height: h };
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Text style={s.title}>Draw rectangles around each problem</Text>
      <Text style={s.subtitle}>{rectangles.length}/{maxRectangles} selected</Text>

      <View
        style={[s.imageContainer, { width: screenWidth, height: screenHeight }]}
        onLayout={(e) => setDisplayLayout(e.nativeEvent.layout)}
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
          return (
            <View
              key={r.id}
              style={[s.rect, { left: d.left, top: d.top, width: d.width, height: d.height }]}
            >
              <View style={s.rectLabel}>
                <Text style={s.rectLabelText}>{i + 1}</Text>
              </View>
              <TouchableOpacity
                style={s.rectDelete}
                onPress={() => deleteRect(r.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.rectDeleteText}>&times;</Text>
              </TouchableOpacity>
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
