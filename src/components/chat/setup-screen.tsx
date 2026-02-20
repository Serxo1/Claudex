import { useState } from "react";
import { CheckCircle2, ClipboardCopy, ExternalLink, Loader2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.png";

type Props = {
  onVerify: () => Promise<void>;
  isVerifying: boolean;
};

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/60 border border-border px-3 py-2 font-mono text-sm">
      <span className="flex-1 select-all text-foreground/80">{command}</span>
      <button
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        onClick={handleCopy}
        title="Copiar"
        type="button"
      >
        {copied ? (
          <CheckCircle2 className="size-4 text-green-500" />
        ) : (
          <ClipboardCopy className="size-4" />
        )}
      </button>
    </div>
  );
}

type StepProps = {
  number: number;
  title: string;
  description: string;
  command?: string;
  done?: boolean;
};

function Step({ number, title, description, command, done }: StepProps) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 mt-0.5">
        {done ? (
          <CheckCircle2 className="size-6 text-green-500" />
        ) : (
          <div className="flex size-6 items-center justify-center rounded-full bg-muted border border-border text-xs font-semibold text-muted-foreground">
            {number}
          </div>
        )}
      </div>
      <div className="flex-1 space-y-2">
        <div className="font-medium text-foreground">{title}</div>
        <p className="text-sm text-muted-foreground">{description}</p>
        {command && <CopyableCommand command={command} />}
      </div>
    </div>
  );
}

export function SetupScreen({ onVerify, isVerifying }: Props) {
  function openExternal(url: string) {
    void window.desktop.terminal.openExternal().catch(() => {
      // fallback — open via anchor
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="w-full max-w-lg space-y-8 px-6">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <img alt="Claudex" className="size-14 rounded-2xl shadow-lg" src={logo} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo ao Claudex</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Para começar, o Claude Code CLI precisa de estar instalado e autenticado.
            </p>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-6">
          <Step
            number={1}
            title="Node.js 18+"
            description="O Claude Code CLI requer Node.js 18 ou superior. Se ainda não tens, instala em nodejs.org."
            command="node --version"
          />

          <div className="border-l border-border/50 ml-3 pl-0" />

          <Step
            number={2}
            title="Instalar o Claude Code CLI"
            description="Instala o CLI globalmente via npm. Pode demorar 1–2 minutos."
            command="npm install -g @anthropic-ai/claude-code"
          />

          <div className="border-l border-border/50 ml-3 pl-0" />

          <Step
            number={3}
            title="Autenticar com a Anthropic"
            description="Executa o comando abaixo no terminal. Irá abrir o browser para login."
            command="claude login"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Button
            className="w-full"
            disabled={isVerifying}
            onClick={() => void onVerify()}
            size="lg"
          >
            {isVerifying ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />A verificar...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 size-4" />
                Verificar instalação
              </>
            )}
          </Button>

          <Button
            className="w-full"
            onClick={() => void window.desktop.terminal.openExternal()}
            size="lg"
            variant="outline"
          >
            <Terminal className="mr-2 size-4" />
            Abrir terminal externo
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Documentação:{" "}
            <button
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => openExternal("https://docs.anthropic.com/claude/claude-code")}
              type="button"
            >
              docs.anthropic.com/claude/claude-code
              <ExternalLink className="ml-0.5 inline size-3" />
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
