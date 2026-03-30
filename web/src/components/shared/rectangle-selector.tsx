"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface Rectangle {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RectangleSelectorProps {
  imageBase64: string;
  onConfirm: (rectangles: Rectangle[]) => void;
  onCancel: () => void;
  maxRectangles?: number;
}

const MIN_SIZE = 30;
const HANDLE_SIZE = 10; // px in display space
const RECT_FILL = "rgba(108, 92, 231, 0.2)";
const RECT_BORDER_COLOR = "rgba(108, 92, 231, 0.9)";

type InteractionMode =
  | { type: "idle" }
  | { type: "drawing"; startX: number; startY: number }
  | { type: "moving"; rectId: number; offsetX: number; offsetY: number }
  | { type: "resizing"; rectId: number; corner: string; anchorX: number; anchorY: number };

export function RectangleSelector({
  imageBase64,
  onConfirm,
  onCancel,
  maxRectangles = 10,
}: RectangleSelectorProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [rectangles, setRectangles] = useState<Rectangle[]>([]);
  const [mode, setMode] = useState<InteractionMode>({ type: "idle" });
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [tooSmallToast, setTooSmallToast] = useState(false);
  const nextId = useRef(1);

  // Scale factors
  const sx = displaySize.w && imgNatural.w ? imgNatural.w / displaySize.w : 1;
  const sy = displaySize.h && imgNatural.h ? imgNatural.h / displaySize.h : 1;
  const isx = displaySize.w && imgNatural.w ? displaySize.w / imgNatural.w : 1;
  const isy = displaySize.h && imgNatural.h ? displaySize.h / imgNatural.h : 1;

  const toImg = useCallback(
    (cx: number, cy: number) => {
      const img = imgRef.current;
      if (!img) return { x: 0, y: 0 };
      const r = img.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(Math.round((cx - r.left) * sx), imgNatural.w)),
        y: Math.max(0, Math.min(Math.round((cy - r.top) * sy), imgNatural.h)),
      };
    },
    [sx, sy, imgNatural],
  );

  const toDsp = useCallback(
    (ix: number, iy: number, iw: number, ih: number) => ({
      left: ix * isx,
      top: iy * isy,
      width: iw * isx,
      height: ih * isy,
    }),
    [isx, isy],
  );

  // Check if pointer is over a handle or inside a rectangle
  const hitTest = useCallback(
    (imgX: number, imgY: number) => {
      const handlePx = HANDLE_SIZE / isx; // handle size in image space
      // Check handles first (higher priority)
      for (let i = rectangles.length - 1; i >= 0; i--) {
        const r = rectangles[i];
        const corners = [
          { name: "nw", cx: r.x, cy: r.y },
          { name: "ne", cx: r.x + r.width, cy: r.y },
          { name: "sw", cx: r.x, cy: r.y + r.height },
          { name: "se", cx: r.x + r.width, cy: r.y + r.height },
        ];
        for (const c of corners) {
          if (Math.abs(imgX - c.cx) < handlePx && Math.abs(imgY - c.cy) < handlePx) {
            return { hit: "handle" as const, rectId: r.id, corner: c.name, rect: r };
          }
        }
      }
      // Check inside rectangles
      for (let i = rectangles.length - 1; i >= 0; i--) {
        const r = rectangles[i];
        if (imgX >= r.x && imgX <= r.x + r.width && imgY >= r.y && imgY <= r.y + r.height) {
          return { hit: "inside" as const, rectId: r.id, rect: r };
        }
      }
      return { hit: "empty" as const };
    },
    [rectangles, isx],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const pos = toImg(e.clientX, e.clientY);
      const test = hitTest(pos.x, pos.y);

      if (test.hit === "handle") {
        // Anchor is the opposite corner
        const r = test.rect;
        const anchors: Record<string, { x: number; y: number }> = {
          nw: { x: r.x + r.width, y: r.y + r.height },
          ne: { x: r.x, y: r.y + r.height },
          sw: { x: r.x + r.width, y: r.y },
          se: { x: r.x, y: r.y },
        };
        const anchor = anchors[test.corner];
        setMode({ type: "resizing", rectId: test.rectId, corner: test.corner, anchorX: anchor.x, anchorY: anchor.y });
      } else if (test.hit === "inside") {
        setMode({ type: "moving", rectId: test.rectId, offsetX: pos.x - test.rect.x, offsetY: pos.y - test.rect.y });
      } else if (rectangles.length < maxRectangles) {
        setMode({ type: "drawing", startX: pos.x, startY: pos.y });
      }
      setCurrentPos(pos);
    },
    [toImg, hitTest, rectangles.length, maxRectangles],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pos = toImg(e.clientX, e.clientY);
      setCurrentPos(pos);

      if (mode.type === "moving") {
        setRectangles((prev) =>
          prev.map((r) =>
            r.id === mode.rectId
              ? { ...r, x: Math.max(0, pos.x - mode.offsetX), y: Math.max(0, pos.y - mode.offsetY) }
              : r,
          ),
        );
      } else if (mode.type === "resizing") {
        const nx = Math.min(mode.anchorX, pos.x);
        const ny = Math.min(mode.anchorY, pos.y);
        const nw = Math.abs(pos.x - mode.anchorX);
        const nh = Math.abs(pos.y - mode.anchorY);
        setRectangles((prev) =>
          prev.map((r) => (r.id === mode.rectId ? { ...r, x: nx, y: ny, width: nw, height: nh } : r)),
        );
      }
    },
    [toImg, mode],
  );

  const handlePointerUp = useCallback(() => {
    if (mode.type === "drawing" && currentPos) {
      const x = Math.min(mode.startX, currentPos.x);
      const y = Math.min(mode.startY, currentPos.y);
      const width = Math.abs(currentPos.x - mode.startX);
      const height = Math.abs(currentPos.y - mode.startY);

      if (width >= MIN_SIZE && height >= MIN_SIZE) {
        setRectangles((prev) => [...prev, { id: nextId.current++, x, y, width, height }]);
        setShowOnboarding(false);
      } else if (width > 5 || height > 5) {
        // User tried to draw but it was too small
        setTooSmallToast(true);
        setTimeout(() => setTooSmallToast(false), 2000);
      }
    }
    setMode({ type: "idle" });
    setCurrentPos(null);
  }, [mode, currentPos]);

  // Cursor based on hover state
  const getCursor = useCallback(
    (e: React.PointerEvent) => {
      if (mode.type !== "idle") return;
      const pos = toImg(e.clientX, e.clientY);
      const test = hitTest(pos.x, pos.y);
      const container = e.currentTarget as HTMLElement;
      if (test.hit === "handle") {
        const cursors: Record<string, string> = { nw: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", se: "nwse-resize" };
        container.style.cursor = cursors[test.corner] ?? "default";
      } else if (test.hit === "inside") {
        container.style.cursor = "move";
      } else {
        container.style.cursor = "crosshair";
      }
    },
    [mode, toImg, hitTest],
  );

  // Draw the in-progress rectangle on canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !displaySize.w) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = displaySize.w;
    canvas.height = displaySize.h;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (mode.type === "drawing" && currentPos) {
      const d = toDsp(
        Math.min(mode.startX, currentPos.x),
        Math.min(mode.startY, currentPos.y),
        Math.abs(currentPos.x - mode.startX),
        Math.abs(currentPos.y - mode.startY),
      );
      ctx.fillStyle = RECT_FILL;
      ctx.strokeStyle = RECT_BORDER_COLOR;
      ctx.lineWidth = 3;
      ctx.fillRect(d.left, d.top, d.width, d.height);
      ctx.strokeRect(d.left, d.top, d.width, d.height);
    }
  }, [mode, currentPos, displaySize, toDsp]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-text-primary">
          Select problems in your image
        </p>
        <span className="text-xs text-text-muted">
          {rectangles.length}/{maxRectangles}
        </span>
      </div>

      <div
        className="relative select-none overflow-hidden rounded-[--radius-md] border border-border"
        onPointerDown={handlePointerDown}
        onPointerMove={(e) => {
          handlePointerMove(e);
          getCursor(e);
        }}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ touchAction: "none" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={`data:image/jpeg;base64,${imageBase64}`}
          alt="Uploaded"
          className="block w-full"
          onLoad={(e) => {
            const el = e.currentTarget;
            setImgNatural({ w: el.naturalWidth, h: el.naturalHeight });
            setDisplaySize({ w: el.clientWidth, h: el.clientHeight });
          }}
          draggable={false}
        />

        {/* Canvas for drawing in-progress rectangle */}
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute left-0 top-0 h-full w-full"
        />

        {/* Onboarding overlay */}
        <AnimatePresence>
          {showOnboarding && rectangles.length === 0 && mode.type === "idle" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px]"
            >
              <div className="rounded-[--radius-lg] bg-surface/90 px-6 py-4 text-center shadow-lg">
                <svg className="mx-auto mb-2 h-8 w-8 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                  <line x1="15" y1="3" x2="15" y2="21" />
                </svg>
                <p className="text-sm font-semibold text-text-primary">
                  Drag to select each problem
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  Draw a rectangle around each problem you want to solve
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Too small toast */}
        <AnimatePresence>
          {tooSmallToast && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-error px-4 py-1.5 text-xs font-semibold text-white shadow-lg"
            >
              Too small — draw a larger area
            </motion.div>
          )}
        </AnimatePresence>

        {/* Finalized rectangles */}
        {rectangles.map((r, i) => {
          const d = toDsp(r.x, r.y, r.width, r.height);
          return (
            <div
              key={r.id}
              className="absolute pointer-events-none"
              style={{
                left: d.left,
                top: d.top,
                width: d.width,
                height: d.height,
                backgroundColor: RECT_FILL,
                border: `3px solid ${RECT_BORDER_COLOR}`,
                borderRadius: 6,
              }}
            >
              {/* Number label */}
              <span className="absolute -top-3 -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white shadow-sm pointer-events-auto">
                {i + 1}
              </span>
              {/* Delete button */}
              <button
                className="absolute -top-3 -right-3 flex h-6 w-6 items-center justify-center rounded-full bg-error text-white text-xs font-bold shadow-sm pointer-events-auto hover:bg-error/80 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setRectangles((prev) => prev.filter((rect) => rect.id !== r.id));
                }}
              >
                &times;
              </button>
              {/* Resize handles — 4 corners */}
              {(["nw", "ne", "sw", "se"] as const).map((corner) => {
                const isLeft = corner.includes("w");
                const isTop = corner.includes("n");
                return (
                  <div
                    key={corner}
                    className={cn(
                      "absolute h-3 w-3 rounded-sm border-2 border-primary bg-white shadow-sm pointer-events-auto",
                    )}
                    style={{
                      [isTop ? "top" : "bottom"]: -6,
                      [isLeft ? "left" : "right"]: -6,
                      cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        {rectangles.length > 0 && (
          <Button variant="secondary" onClick={() => setRectangles([])}>
            Clear
          </Button>
        )}
        <Button
          gradient
          onClick={() => onConfirm(rectangles)}
          disabled={rectangles.length === 0}
          className="flex-1"
        >
          Extract {rectangles.length} Problem{rectangles.length !== 1 ? "s" : ""}
        </Button>
      </div>
    </div>
  );
}
