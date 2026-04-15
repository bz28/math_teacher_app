"use client";

import { useState } from "react";
import { Button, Card, TypingIndicator } from "@/components/ui";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "./step-timeline";

interface Props {
  messages: ChatMessage[];
  onSend: (question: string) => Promise<void>;
  placeholder?: string;
  /** External disable flag — e.g. when the parent is mid-flight. */
  disabled?: boolean;
  /** Render "Thinking…" under the last assistant turn. */
  thinking?: boolean;
  /** Optional title shown above the chat thread. */
  title?: string;
}

/**
 * Post-completion chat about the whole problem. Presentational only —
 * the parent owns the message list and the send handler.
 */
export function ProblemChat({
  messages,
  onSend,
  placeholder = "Ask about this problem…",
  disabled = false,
  thinking = false,
  title,
}: Props) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const busy = sending || thinking || disabled;

  async function handleSend() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setSending(true);
    try {
      await onSend(q);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      {title && (
        <p className="text-xs font-semibold text-text-muted">{title}</p>
      )}

      {messages.length > 0 && (
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <MessageRow key={i} message={msg} />
          ))}
        </div>
      )}

      {thinking && <TypingIndicator />}

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (input.trim()) handleSend();
            }
          }}
          placeholder={placeholder}
          disabled={busy}
          className="flex-1 rounded-[--radius-md] border border-border bg-input-bg px-4 py-2.5 text-sm placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
        />
        <Button
          size="sm"
          onClick={handleSend}
          loading={sending}
          disabled={busy || !input.trim()}
        >
          Ask
        </Button>
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[--radius-md] bg-primary-bg px-4 py-3 text-sm text-primary">
          <MathText text={message.content} />
        </div>
      </div>
    );
  }
  return (
    <Card variant="flat" className={cn("border-primary/15")}>
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
            <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
          </svg>
        </div>
        <div>
          <p className="text-xs font-semibold text-primary">Tutor</p>
          <div className="mt-1 text-sm leading-relaxed text-text-primary">
            <MathText text={message.content} />
          </div>
        </div>
      </div>
    </Card>
  );
}
