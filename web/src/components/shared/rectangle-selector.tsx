"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

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

const MIN_SIZE = 30; // minimum rectangle size in image-space pixels
const RECT_COLOR = "rgba(108, 92, 231, 0.3)";
const RECT_BORDER = "rgba(108, 92, 231, 0.8)";

export function RectangleSelector({
  imageBase64,
  onConfirm,
  onCancel,
  maxRectangles = 10,
}: RectangleSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [rectangles, setRectangles] = useState<Rectangle[]>([]);
  const [drawing, setDrawing] = useState<{ startX: number; startY: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const nextId = useRef(1);

  // Convert display coordinates to image-space coordinates
  const toImageSpace = useCallback(
    (displayX: number, displayY: number) => {
      const img = imgRef.current;
      if (!img || !imgNatural.w) return { x: 0, y: 0 };
      const rect = img.getBoundingClientRect();
      const scaleX = imgNatural.w / rect.width;
      const scaleY = imgNatural.h / rect.height;
      return {
        x: Math.round((displayX - rect.left) * scaleX),
        y: Math.round((displayY - rect.top) * scaleY),
      };
    },
    [imgNatural],
  );

  // Convert image-space to display coordinates
  const toDisplaySpace = useCallback(
    (imgX: number, imgY: number, imgW: number, imgH: number) => {
      const img = imgRef.current;
      if (!img || !imgNatural.w) return { left: 0, top: 0, width: 0, height: 0 };
      const rect = img.getBoundingClientRect();
      const scaleX = rect.width / imgNatural.w;
      const scaleY = rect.height / imgNatural.h;
      return {
        left: imgX * scaleX,
        top: imgY * scaleY,
        width: imgW * scaleX,
        height: imgH * scaleY,
      };
    },
    [imgNatural],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (rectangles.length >= maxRectangles) return;
      const pos = toImageSpace(e.clientX, e.clientY);
      setDrawing({ startX: pos.x, startY: pos.y });
      setCurrentPos(pos);
    },
    [rectangles.length, maxRectangles, toImageSpace],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawing) return;
      const pos = toImageSpace(e.clientX, e.clientY);
      setCurrentPos(pos);
    },
    [drawing, toImageSpace],
  );

  const handlePointerUp = useCallback(() => {
    if (!drawing || !currentPos) {
      setDrawing(null);
      return;
    }
    const x = Math.min(drawing.startX, currentPos.x);
    const y = Math.min(drawing.startY, currentPos.y);
    const width = Math.abs(currentPos.x - drawing.startX);
    const height = Math.abs(currentPos.y - drawing.startY);

    if (width >= MIN_SIZE && height >= MIN_SIZE) {
      setRectangles((prev) => [
        ...prev,
        { id: nextId.current++, x, y, width, height },
      ]);
    }
    setDrawing(null);
    setCurrentPos(null);
  }, [drawing, currentPos]);

  const deleteRect = useCallback((id: number) => {
    setRectangles((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // Draw the in-progress rectangle on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgNatural.w) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = img.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (drawing && currentPos) {
      const display = toDisplaySpace(
        Math.min(drawing.startX, currentPos.x),
        Math.min(drawing.startY, currentPos.y),
        Math.abs(currentPos.x - drawing.startX),
        Math.abs(currentPos.y - drawing.startY),
      );
      ctx.fillStyle = RECT_COLOR;
      ctx.strokeStyle = RECT_BORDER;
      ctx.lineWidth = 2;
      ctx.fillRect(display.left, display.top, display.width, display.height);
      ctx.strokeRect(display.left, display.top, display.width, display.height);
    }
  }, [drawing, currentPos, imgNatural, toDisplaySpace]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-text-primary">
          Draw rectangles around each problem
        </p>
        <span className="text-xs text-text-muted">
          {rectangles.length}/{maxRectangles}
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative select-none overflow-hidden rounded-[--radius-md] border border-border"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
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
          }}
          draggable={false}
        />

        {/* Canvas for drawing in-progress rectangle */}
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute left-0 top-0 h-full w-full"
        />

        {/* Finalized rectangles as overlays */}
        {rectangles.map((r, i) => {
          const display = toDisplaySpace(r.x, r.y, r.width, r.height);
          return (
            <div
              key={r.id}
              className="absolute pointer-events-none"
              style={{
                left: display.left,
                top: display.top,
                width: display.width,
                height: display.height,
                backgroundColor: RECT_COLOR,
                border: `2px solid ${RECT_BORDER}`,
                borderRadius: 4,
              }}
            >
              {/* Number label */}
              <span className="absolute -top-2 -left-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white pointer-events-auto">
                {i + 1}
              </span>
              {/* Delete button */}
              <button
                className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-error text-white text-[10px] font-bold pointer-events-auto hover:bg-error/80"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteRect(r.id);
                }}
              >
                &times;
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        {rectangles.length > 0 && (
          <Button
            variant="secondary"
            onClick={() => setRectangles([])}
          >
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
