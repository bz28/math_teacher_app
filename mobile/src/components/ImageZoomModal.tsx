import { useMemo } from "react";
import { Dimensions, Image, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { useColors, spacing, typography, type ColorPalette } from "../theme";
import type { SubmissionFile } from "../services/api";

interface Props {
  /** The file to preview, or null to keep the modal closed. */
  file: SubmissionFile | null;
  /** Fallback label when the file has no filename (e.g. "Page 2"). */
  label?: string;
  onClose: () => void;
}

/**
 * Full-screen preview of a submitted page. Images get pinch-to-zoom (via the
 * ScrollView zoom on iOS) and tap-to-close; PDFs show a document placeholder
 * since RN can't render a PDF inline without a heavier dependency — the point
 * is to confirm "this is the file my teacher will see," which the filename and
 * type convey. Mirrors the web SubmittedView ZoomModal affordance.
 */
export function ImageZoomModal({ file, label, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isPdf = file?.media_type === "application/pdf";
  const title = file?.filename ?? label ?? "Submitted page";

  return (
    <Modal visible={file !== null} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.topBar}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <AnimatedPressable onPress={onClose} style={styles.closeButton} accessibilityLabel="Close preview">
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </AnimatedPressable>
        </View>

        {file && isPdf ? (
          <AnimatedPressable style={styles.pdfBox} onPress={onClose} scaleDown={1}>
            <Ionicons name="document-text-outline" size={72} color="#FFFFFF" />
            <Text style={styles.pdfTitle}>{file.filename ?? "PDF document"}</Text>
            <Text style={styles.pdfSub}>Your teacher will see this PDF.</Text>
          </AnimatedPressable>
        ) : file ? (
          <ScrollView
            style={styles.imageScroll}
            contentContainerStyle={styles.imageContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
          >
            <AnimatedPressable onPress={onClose} scaleDown={1}>
              <Image
                source={{ uri: `data:${file.media_type};base64,${file.data}` }}
                style={styles.image}
                resizeMode="contain"
              />
            </AnimatedPressable>
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const makeStyles = (_colors: ColorPalette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(10, 10, 7, 0.94)" },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
    title: { ...typography.label, color: "#FFFFFF", flex: 1, fontSize: 13 },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "rgba(255, 255, 255, 0.12)",
      alignItems: "center",
      justifyContent: "center",
    },
    imageScroll: { flex: 1 },
    imageContent: { flexGrow: 1, justifyContent: "center", alignItems: "center" },
    image: { width: SCREEN_W, height: SCREEN_H * 0.8 },
    pdfBox: { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.md, padding: spacing.xxxl },
    pdfTitle: { ...typography.heading, color: "#FFFFFF", fontSize: 18, textAlign: "center" },
    pdfSub: { ...typography.body, color: "rgba(255, 255, 255, 0.7)", fontSize: 14, textAlign: "center" },
  });
