import type { ComponentProps, ReactNode } from "react";
import { Bot, Bug, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

export type SettingsMenuProps = {
  align: ComponentProps<typeof DropdownMenuContent>["align"];
  children: ReactNode;
};

export function SettingsMenu({ align, children }: SettingsMenuProps) {
  const settings = useSettingsStore((s) => s.settings);
  const status = useSettingsStore((s) => s.status);
  const busy = useSettingsStore((s) => s.isBusy);
  const apiKeyDraft = useSettingsStore((s) => s.apiKeyDraft);
  const setApiKeyDraft = useSettingsStore((s) => s.setApiKeyDraft);
  const onAuthModeChange = useSettingsStore((s) => s.onAuthModeChange);
  const onSaveApiKey = useSettingsStore((s) => s.onSaveApiKey);
  const onClearApiKey = useSettingsStore((s) => s.onClearApiKey);
  const onClearCliSession = useSettingsStore((s) => s.onClearCliSession);
  const onTestCli = useSettingsStore((s) => s.onTestCli);
  const workspaceName = useWorkspaceStore((s) => s.workspace?.name || "Local workspace");

  const accountLabel =
    settings?.authMode === "claude-cli"
      ? "Claude CLI account"
      : settings?.hasApiKey
        ? "Anthropic API key configured"
        : "No API key configured";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="w-[320px] rounded-2xl border border-border/70 bg-background p-2 text-foreground shadow-2xl backdrop-blur-xl"
        sideOffset={8}
      >
        <div className="px-2.5 pt-1.5 pb-1">
          <div className="flex items-center gap-2">
            <UserRound className="size-4 text-white/60" />
            <span className="truncate text-sm font-semibold">{workspaceName}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-white/60">{accountLabel}</p>
        </div>

        <div className="mt-1 space-y-2 rounded-xl border border-border/70 bg-background p-2.5">
          <DropdownMenuLabel className="px-0 pb-0.5 text-[11px] font-medium tracking-[0.08em] text-white/60 uppercase">
            Connection
          </DropdownMenuLabel>

          <div className="grid grid-cols-2 gap-1">
            <Button
              className="h-7 text-xs"
              onClick={() => void onAuthModeChange("claude-cli")}
              type="button"
              variant={settings?.authMode === "claude-cli" ? "secondary" : "outline"}
            >
              CLI session
            </Button>
            <Button
              className="h-7 text-xs"
              onClick={() => void onAuthModeChange("api-key")}
              type="button"
              variant={settings?.authMode === "api-key" ? "secondary" : "outline"}
            >
              API key
            </Button>
          </div>

          {settings?.authMode === "api-key" ? (
            <div className="space-y-2">
              <Input
                className="h-7 text-xs"
                onChange={(event) => setApiKeyDraft(event.target.value)}
                placeholder={settings.hasApiKey ? "Saved key detected" : "sk-ant-..."}
                type="password"
                value={apiKeyDraft}
              />
              <div className="flex gap-1.5">
                <Button
                  className="h-7 px-2.5 text-xs"
                  disabled={busy || !apiKeyDraft.trim()}
                  onClick={() => void onSaveApiKey()}
                  type="button"
                >
                  Save key
                </Button>
                <Button
                  className="h-7 px-2.5 text-xs"
                  disabled={busy || !settings.hasApiKey}
                  onClick={() => void onClearApiKey()}
                  type="button"
                  variant="outline"
                >
                  Clear
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                className="h-7 text-xs"
                onClick={() => void onTestCli()}
                type="button"
                variant="outline"
              >
                <Bot className="size-3.5" />
                Test Claude CLI
              </Button>
              {settings?.hasClaudeCliSession ? (
                <Button
                  className="h-7 text-xs"
                  onClick={() => void onClearCliSession()}
                  type="button"
                  variant="outline"
                >
                  Start new CLI session
                </Button>
              ) : null}
            </div>
          )}

          <p className="text-[10px] text-white/60">{status}</p>
        </div>

        <div className="mt-2 space-y-2 rounded-xl border border-border/70 bg-background p-2.5">
          <DropdownMenuLabel className="px-0 pb-0.5 text-[11px] font-medium tracking-[0.08em] text-white/60 uppercase">
            Debug
          </DropdownMenuLabel>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
