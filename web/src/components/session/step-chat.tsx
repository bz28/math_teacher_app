"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSessionStore } from "@/stores/session";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export function StepChat() {
  const { session, chatHistory, askAboutStep, phase } = useSessionStore();
  const [question, setQuestion] = useState("");
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const stepNum = session?.current_step ?? 1;
  const messages = chatHistory[stepNum] ?? [];
  const messageCount = messages.length;
  const isThinking = phase === "thinking";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messageCount]);

  async function handleSend() {
    if (!question.trim()) return;
    const q = question.trim();
    setQuestion("");
    setExpanded(true);
    await askAboutStep(q);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="rounded-[--radius-lg] border border-border-light bg-white overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between px-5 py-3 text-sm font-semibold text-text-secondary hover:bg-primary-bg/30 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          Ask about this step
          {messages.length > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-white">
              {messages.length}
            </span>
          )}
        </span>
        <svg
          className={cn(
            "h-4 w-4 transition-transform",
            expanded && "rotate-180",
          )}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border-light">
              {/* Messages */}
              <div
                ref={scrollRef}
                className="max-h-64 overflow-y-auto px-5 py-4 space-y-3"
              >
                {messages.length === 0 && (
                  <p className="text-center text-sm text-text-muted py-4">
                    Ask a question about this step and get an instant
                    explanation.
                  </p>
                )}
                {messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "max-w-[85%] rounded-[--radius-md] px-4 py-2.5 text-sm",
                      msg.role === "user"
                        ? "ml-auto bg-primary text-white"
                        : "bg-card text-text-primary border border-border-light",
                    )}
                  >
                    {msg.text}
                  </motion.div>
                ))}
              </div>

              {/* Input */}
              <div className="flex gap-2 border-t border-border-light px-5 py-3">
                <input
                  placeholder="Ask a question..."
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isThinking}
                  className="flex-1 rounded-[--radius-md] border border-border bg-input-bg px-4 py-2 text-sm placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                />
                <Button
                  size="sm"
                  onClick={handleSend}
                  loading={isThinking}
                  disabled={!question.trim()}
                >
                  Send
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
