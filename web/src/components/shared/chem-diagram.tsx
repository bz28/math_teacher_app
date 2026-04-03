"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ChemDiagram — renders a SMILES string as a 2D molecular structure
 * using smiles-drawer. Falls back to raw SMILES text on error.
 */

interface ChemDiagramProps {
  smiles: string;
  label?: string;
  width?: number;
  height?: number;
}

export function ChemDiagram({ smiles, label, width = 400, height = 300 }: ChemDiagramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !smiles) return;

    let cancelled = false;

    async function render() {
      try {
        // Dynamic import to avoid SSR issues
        const SmilesDrawer = (await import("smiles-drawer")).default;
        if (cancelled) return;

        const drawer = new SmilesDrawer.SmiDrawer({ width, height });
        drawer.draw(smiles, canvasRef.current!, "light");
      } catch {
        if (!cancelled) setError(true);
      }
    }

    render();
    return () => { cancelled = true; };
  }, [smiles, width, height]);

  if (error) {
    return (
      <div className="my-3 rounded-lg bg-surface-raised p-3 text-sm text-text-secondary">
        <p className="font-mono text-xs">{smiles}</p>
        {label && <p className="mt-1 text-xs text-text-muted">{label}</p>}
      </div>
    );
  }

  return (
    <div className="my-3 flex flex-col items-center">
      <div className="rounded-lg bg-white p-4">
        <canvas ref={canvasRef} width={width} height={height} />
      </div>
      {label && <p className="mt-2 text-xs text-text-muted">{label}</p>}
    </div>
  );
}
