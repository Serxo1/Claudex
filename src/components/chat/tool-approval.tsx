"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckIcon, XIcon, ShieldIcon, MessageSquareIcon, InfinityIcon } from "lucide-react";
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
    <div className="mx-4 mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldIcon className="size-4 text-yellow-500" />
        <span className="text-sm font-medium">Pedido de permissão</span>
        <Badge className="rounded-full text-xs" variant="secondary">
          {approval.toolName}
        </Badge>
      </div>

      {summary && (
        <p className="mb-3 rounded-md bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
          {summary}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          className="h-7 gap-1.5 text-xs"
          disabled={loading !== null}
          onClick={handleApprove}
          size="sm"
          variant="default"
        >
          <CheckIcon className="size-3" />
          {loading === "approve" ? "A permitir..." : "Permitir"}
        </Button>

        {suggestedRule && (
          <Button
            className="h-7 gap-1.5 text-xs"
            disabled={loading !== null}
            onClick={handleAlways}
            size="sm"
            variant="outline"
            title={`Guardar regra: sempre permitir ${suggestedRule.label}`}
          >
            <InfinityIcon className="size-3" />
            {loading === "always" ? "A guardar..." : `Sempre: ${suggestedRule.label}`}
          </Button>
        )}

        <Button
          className="h-7 gap-1.5 text-xs"
          disabled={loading !== null}
          onClick={handleDeny}
          size="sm"
          variant="outline"
        >
          <XIcon className="size-3" />
          {loading === "deny" ? "A negar..." : "Negar"}
        </Button>
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
    <div className="mx-4 mb-4 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
      <div className="mb-4 flex items-center gap-2">
        <MessageSquareIcon className="size-4 text-blue-500" />
        <span className="text-sm font-medium">Claude tem uma pergunta</span>
      </div>

      <div className="space-y-4">
        {question.questions.map((q) => (
          <div key={q.question}>
            <p className="mb-2 text-sm font-medium">{q.question}</p>
            <div className="flex flex-wrap gap-2">
              {q.options.map((option) => {
                const selected = answers[q.question]?.split(", ").includes(option.label);
                return (
                  <button
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-left text-xs transition-colors",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted"
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

      <div className="mt-4">
        <Button
          className="h-7 text-xs"
          disabled={!allAnswered || loading}
          onClick={handleSubmit}
          size="sm"
        >
          {loading ? "A enviar..." : "Responder"}
        </Button>
      </div>
    </div>
  );
}
