import { useState, useEffect } from "react";
import { Bug, CheckCircle2, Puzzle, UserRound, XCircle, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import { SetupGuide } from "@/components/chat/setup-guide";
import { McpPanel } from "@/components/chat/mcp-panel";

/** Rendered inline inside the sidebar — no dropdown wrapper */
export function SettingsContent() {
  const claudeCodeReady = useSettingsStore((s) => s.claudeCodeReady);
  const accountInfo = useSettingsStore((s) => s.accountInfo);
  const onClearCliSession = useSettingsStore((s) => s.onClearCliSession);
  const settings = useSettingsStore((s) => s.settings);
  const workspaceName = useWorkspaceStore((s) => s.workspace?.name || "Local workspace");
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [ideList, setIdeList] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    window.desktop.ide.getInfo().then((list: any) => {
      if (Array.isArray(list)) setIdeList(list);
    });
     
  }, []);

  const handleIdeChange = async (val: string) => {
    await window.desktop.settings.setPreferredIde(val);
    await useSettingsStore.getState().refreshSettings();
  };

  return (
    <>
      <div className="flex flex-col gap-3 p-3">
        {/* Account */}
        <div className="flex items-center gap-2 px-0.5">
          <UserRound className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{workspaceName}</p>
            {accountInfo?.email ? (
              <p className="truncate text-xs text-muted-foreground">{accountInfo.email}</p>
            ) : null}
          </div>
        </div>

        {/* Claude Code status */}
        <div className="rounded-xl border border-border/60 bg-muted/10 p-2.5 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
            Claude Code
          </p>
          <div className="flex items-center gap-2">
            {claudeCodeReady === null ? (
              <span className="size-2 rounded-full bg-muted-foreground/40" />
            ) : claudeCodeReady ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
            ) : (
              <XCircle className="size-4 shrink-0 text-destructive" />
            )}
            <span
              className={cn(
                "flex-1 text-sm",
                claudeCodeReady === true
                  ? "text-emerald-600 dark:text-emerald-400"
                  : claudeCodeReady === false
                    ? "text-destructive"
                    : "text-muted-foreground"
              )}
            >
              {claudeCodeReady === null
                ? "A verificar..."
                : claudeCodeReady
                  ? "Ready"
                  : "Not configured"}
            </span>
            {!claudeCodeReady && claudeCodeReady !== null ? (
              <Button
                className="h-6 text-xs"
                onClick={() => setShowSetupGuide(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                Setup guide
              </Button>
            ) : null}
          </div>
          {accountInfo?.subscriptionType ? (
            <p className="text-[11px] text-muted-foreground">
              Plano: {accountInfo.subscriptionType}
            </p>
          ) : null}
          {settings?.hasClaudeCliSession ? (
            <Button
              className="h-7 w-full text-xs"
              onClick={() => void onClearCliSession()}
              type="button"
              variant="outline"
            >
              Nova sessão CLI
            </Button>
          ) : null}
        </div>

        {/* IDE Selector */}
        <div className="rounded-xl border border-border/60 bg-muted/10 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 pb-1">
            <Monitor className="size-3 text-muted-foreground" />
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
              Editor Preferido
            </p>
          </div>
          <Select
            value={settings?.preferredIde || ""}
            onValueChange={handleIdeChange}
            disabled={ideList.length === 0}
          >
            <SelectTrigger className="h-7 w-full text-xs">
              <SelectValue
                placeholder={ideList.length > 0 ? "Selecione..." : "Nenhum editor detectado"}
              />
            </SelectTrigger>
            <SelectContent>
              {ideList.map((ide) => (
                <SelectItem key={ide.id} value={ide.id} className="text-xs">
                  {ide.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Plugins */}
        <div className="rounded-xl border border-border/60 bg-muted/10">
          <div className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1">
            <Puzzle className="size-3 text-muted-foreground" />
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
              Plugins
            </p>
          </div>
          <McpPanel />
        </div>

        {/* Debug */}
        <div className="rounded-xl border border-border/60 bg-muted/10 p-2.5 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
            Debug
          </p>
          <Button
            className="h-7 w-full text-xs"
            onClick={() => void window.desktop.debug.openDevTools()}
            type="button"
            variant="outline"
          >
            <Bug className="size-3.5" />
            Open DevTools
          </Button>
        </div>
      </div>

      <SetupGuide open={showSetupGuide} onOpenChange={setShowSetupGuide} />
    </>
  );
}
