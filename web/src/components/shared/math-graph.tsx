"use client";

import { Mafs, CartesianCoordinates, Plot, Point, Text as MafsText, Theme } from "mafs";
import "mafs/core.css";

/**
 * MathGraph — renders math functions and points on a coordinate plane
 * using the mafs library.
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

interface MathGraphProps {
  functions?: GraphFunction[];
  points?: GraphPoint[];
  xRange?: [number, number];
  yRange?: [number, number];
}

// Simple math expression evaluator for basic functions
function evalFn(expr: string): (x: number) => number {
  // Replace common math notation with JS
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
  return (
    <div className="my-3 rounded-lg bg-white p-2">
      <Mafs
        viewBox={{ x: xRange, y: yRange }}
        preserveAspectRatio={false}
        height={300}
      >
        <CartesianCoordinates />
        <Theme.Foreground color="#1e293b" />

        {functions.map((f, i) => {
          try {
            const fn = evalFn(f.fn);
            return (
              <Plot.OfX
                key={i}
                y={fn}
                color={f.color || COLORS[i % COLORS.length]}
              />
            );
          } catch {
            return null;
          }
        })}

        {points.map((p, i) => (
          <Point key={i} x={p.x} y={p.y} color="#ef4444" />
        ))}

        {points.filter((p) => p.label).map((p, i) => (
          <MafsText key={`label-${i}`} x={p.x} y={p.y + 0.8} size={14}>
            {p.label!}
          </MafsText>
        ))}
      </Mafs>
    </div>
  );
}
