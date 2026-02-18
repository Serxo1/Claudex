"use client";

import { useState } from "react";
import {
  CheckIcon,
  XIcon,
  ShieldIcon,
  MessageSquareIcon,
  InfinityIcon,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { cn } from "@/lib/utils";
import { summarizeToolInput } from "@/lib/chat-utils";
import type { PendingApproval, PendingQuestion } from "@/stores/chat-store";
import { usePermissionsStore, deriveAllowRule } from "@/stores/permissions-store";

// ---------------------------------------------------------------------------
// Tool permission approval
// ---------------------------------------------------------------------------

interface ToolApprovalProps {
  approval: PendingApproval;
  onApprove: (approvalId: string, input: Record<string, unknown>) => Promise<void>;
  onDeny: (approvalId: string) => Promise<void>;
}

export function ToolApproval({ approval, onApprove, onDeny }: ToolApprovalProps) {
  const [loading, setLoading] = useState<"approve" | "always" | "deny" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const addRule = usePermissionsStore((s) => s.addRule);

  const suggestedRule = deriveAllowRule(approval.toolName, approval.input);

  const handleApprove = async () => {
    setLoading("approve");
    await onApprove(approval.approvalId, approval.input);
  };

  const handleAlways = async () => {
    if (!suggestedRule) return;
    setLoading("always");
    addRule(suggestedRule);
    await onApprove(approval.approvalId, approval.input);
  };

  const handleDeny = async () => {
    setLoading("deny");
    await onDeny(approval.approvalId);
  };

  const summary = summarizeToolInput(approval.input);

  return (
    <div className="mx-4 mb-4 overflow-hidden rounded-xl border border-amber-500/25 bg-amber-500/[0.05] backdrop-blur-sm dark:border-amber-500/20 dark:bg-amber-500/[0.04]">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
          <ShieldIcon className="size-3 text-amber-600 dark:text-amber-400" />
        </div>
        <span className="flex-1 text-xs font-semibold text-foreground">Pedido de permissão</span>
        <span className="rounded-md border border-amber-500/20 bg-amber-500/8 px-2 py-0.5 text-[10px] font-mono font-medium text-amber-600 dark:text-amber-400">
          {approval.toolName}
        </span>
        {summary && (
          <button
            className="flex size-5 items-center justify-center rounded text-muted-foreground/50 transition hover:text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
            type="button"
          >
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        )}
      </div>

      {/* Summary — collapsible */}
      {summary && expanded && (
        <div className="border-t border-amber-500/15 px-4 py-2.5">
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">{summary}</p>
        </div>
      )}

      {/* Summary pill — always visible */}
      {summary && !expanded && (
        <button
          className="w-full border-t border-amber-500/10 px-4 py-2 text-left transition hover:bg-amber-500/[0.04]"
          onClick={() => setExpanded(true)}
          type="button"
        >
          <p className="truncate font-mono text-[11px] text-muted-foreground/70">{summary}</p>
        </button>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-amber-500/15 px-4 py-2.5">
        <button
          className="flex h-7 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50"
          disabled={loading !== null}
          onClick={handleApprove}
          type="button"
        >
          <CheckIcon className="size-3" />
          {loading === "approve" ? "A permitir..." : "Permitir"}
        </button>

        {suggestedRule && (
          <button
            className="flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-xs text-muted-foreground transition hover:border-border hover:text-foreground disabled:opacity-50"
            disabled={loading !== null}
            onClick={handleAlways}
            title={`Guardar regra: sempre permitir ${suggestedRule.label}`}
            type="button"
          >
            <InfinityIcon className="size-3" />
            {loading === "always" ? "A guardar..." : `Sempre: ${suggestedRule.label}`}
          </button>
        )}

        <button
          className="ml-auto flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-xs text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive disabled:opacity-50"
          disabled={loading !== null}
          onClick={handleDeny}
          type="button"
        >
          <XIcon className="size-3" />
          {loading === "deny" ? "A negar..." : "Negar"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AskUserQuestion
// ---------------------------------------------------------------------------

interface AskUserQuestionProps {
  question: PendingQuestion;
  onAnswer: (approvalId: string, answers: Record<string, string>) => Promise<void>;
}

export function AskUserQuestion({ question, onAnswer }: AskUserQuestionProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const allAnswered = question.questions.every((q) => answers[q.question]);

  const handleSubmit = async () => {
    if (!allAnswered) return;
    setLoading(true);
    await onAnswer(question.approvalId, answers);
  };

  const handleSelect = (questionText: string, label: string, multiSelect: boolean) => {
    setAnswers((prev) => {
      if (!multiSelect) return { ...prev, [questionText]: label };
      const current = prev[questionText] ? prev[questionText].split(", ") : [];
      const next = current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label];
      return { ...prev, [questionText]: next.join(", ") };
    });
  };

  return (
    <div className="mx-4 mb-4 overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.04] backdrop-blur-sm dark:border-primary/15 dark:bg-primary/[0.04]">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-primary/15 px-4 py-3">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
          <MessageSquareIcon className="size-3 text-primary" />
        </div>
        <span className="text-xs font-semibold text-foreground">Claude tem uma pergunta</span>
      </div>

      {/* Questions */}
      <div className="space-y-4 px-4 py-3.5">
        {question.questions.map((q) => (
          <div key={q.question}>
            <p className="mb-2.5 text-xs font-medium text-foreground/90">{q.question}</p>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((option) => {
                const selected = answers[q.question]?.split(", ").includes(option.label);
                return (
                  <button
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-left text-xs transition-all duration-100",
                      selected
                        ? "border-primary/50 bg-primary/10 text-primary shadow-sm"
                        : "border-border/50 bg-background/40 text-muted-foreground hover:border-border hover:bg-background/70 hover:text-foreground"
                    )}
                    key={option.label}
                    onClick={() => handleSelect(q.question, option.label, q.multiSelect)}
                    title={option.description}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Submit */}
      <div className="flex justify-end border-t border-primary/15 px-4 py-2.5">
        <button
          className="flex h-7 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
          disabled={!allAnswered || loading}
          onClick={handleSubmit}
          type="button"
        >
          {loading ? "A enviar..." : "Responder"}
        </button>
      </div>
    </div>
  );
}
