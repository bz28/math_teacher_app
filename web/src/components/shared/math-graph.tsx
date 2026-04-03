"use client";

import { useEffect, useRef, useState } from "react";

/**
 * MathGraph — renders math functions and points on a coordinate plane.
 * Uses canvas-based rendering to avoid SSR issues with mafs.
 */

interface GraphFunction {
  fn: string;
  color?: string;
}

interface GraphPoint {
  x: number;
  y: number;
  label?: string;
}

export interface MathGraphProps {
  functions?: GraphFunction[];
  points?: GraphPoint[];
  xRange?: [number, number];
  yRange?: [number, number];
}

// Simple math expression evaluator
function evalFn(expr: string): (x: number) => number {
  const jsExpr = expr
    .replace(/\^/g, "**")
    .replace(/sin/g, "Math.sin")
    .replace(/cos/g, "Math.cos")
    .replace(/tan/g, "Math.tan")
    .replace(/sqrt/g, "Math.sqrt")
    .replace(/abs/g, "Math.abs")
    .replace(/ln/g, "Math.log")
    .replace(/log/g, "Math.log10")
    .replace(/pi/g, "Math.PI")
    .replace(/e(?![a-z])/g, "Math.E");

  // eslint-disable-next-line no-new-func
  return new Function("x", `try { return ${jsExpr}; } catch { return NaN; }`) as (x: number) => number;
}

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

export function MathGraph({
  functions = [],
  points = [],
  xRange = [-10, 10],
  yRange = [-10, 10],
}: MathGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const [xMin, xMax] = xRange;
    const [yMin, yMax] = yRange;

    const toX = (x: number) => ((x - xMin) / (xMax - xMin)) * w;
    const toY = (y: number) => h - ((y - yMin) / (yMax - yMin)) * h;

    // Clear
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    for (let x = Math.ceil(xMin); x <= xMax; x++) {
      ctx.beginPath();
      ctx.moveTo(toX(x), 0);
      ctx.lineTo(toX(x), h);
      ctx.stroke();
    }
    for (let y = Math.ceil(yMin); y <= yMax; y++) {
      ctx.beginPath();
      ctx.moveTo(0, toY(y));
      ctx.lineTo(w, toY(y));
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    if (yMin <= 0 && yMax >= 0) {
      ctx.beginPath();
      ctx.moveTo(0, toY(0));
      ctx.lineTo(w, toY(0));
      ctx.stroke();
    }
    if (xMin <= 0 && xMax >= 0) {
      ctx.beginPath();
      ctx.moveTo(toX(0), 0);
      ctx.lineTo(toX(0), h);
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = "#64748b";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    for (let x = Math.ceil(xMin); x <= xMax; x++) {
      if (x === 0) continue;
      ctx.fillText(String(x), toX(x), toY(0) + 14);
    }
    ctx.textAlign = "right";
    for (let y = Math.ceil(yMin); y <= yMax; y++) {
      if (y === 0) continue;
      ctx.fillText(String(y), toX(0) - 4, toY(y) + 4);
    }

    // Plot functions
    try {
      functions.forEach((f, fi) => {
        const fn = evalFn(f.fn);
        ctx.strokeStyle = f.color || COLORS[fi % COLORS.length];
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let started = false;
        const step = (xMax - xMin) / w;
        for (let x = xMin; x <= xMax; x += step) {
          const y = fn(x);
          if (isNaN(y) || !isFinite(y)) { started = false; continue; }
          const px = toX(x);
          const py = toY(y);
          if (py < -100 || py > h + 100) { started = false; continue; }
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(true);
    }

    // Plot points
    points.forEach((p) => {
      const px = toX(p.x);
      const py = toY(p.y);
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

      if (p.label) {
        ctx.fillStyle = "#1e293b";
        ctx.font = "12px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(p.label, px, py - 10);
      }
    });
  }, [functions, points, xRange, yRange]);

  if (error) {
    return (
      <div className="my-3 rounded-lg bg-surface-raised p-3 text-sm text-text-secondary">
        Could not render graph
      </div>
    );
  }

  return (
    <div className="my-3 flex justify-center">
      <div className="rounded-lg bg-white p-2">
        <canvas ref={canvasRef} width={500} height={350} className="max-w-full" />
      </div>
    </div>
  );
}
