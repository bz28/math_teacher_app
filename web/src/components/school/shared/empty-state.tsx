/** Dashed-border placeholder for empty lists across the school workspace. */
export function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle p-8 text-center text-sm text-text-muted">
      {text}
    </div>
  );
}
