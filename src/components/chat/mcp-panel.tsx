import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw } from "lucide-react";

type Plugin = {
  name: string;
  type: "mcp" | "plugin";
  enabled: boolean;
  status: "connected" | "error" | "disconnected";
  command?: string;
  description?: string;
};

type LoadState = "loading" | "loaded" | "error";

export function McpPanel() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const loadPlugins = async () => {
    setState("loading");
    try {
      const result = await window.desktop.mcp.getServers();
      setPlugins(result);
      setState("loaded");
    } catch {
      setState("error");
    }
  };

  useEffect(() => {
    void loadPlugins();
  }, []);

  return (
    <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
      <div className="flex items-center gap-1">
        <Button
          className="h-6 text-xs"
          disabled={state === "loading"}
          onClick={() => void loadPlugins()}
          size="sm"
          title="Actualizar"
          type="button"
          variant="ghost"
        >
          <RefreshCw className={cn("size-3", state === "loading" && "animate-spin")} />
        </Button>
        <Button
          className="h-6 text-xs"
          onClick={() => void window.desktop.mcp.openConfigFile()}
          size="sm"
          title="Editar settings.json"
          type="button"
          variant="ghost"
        >
          <ExternalLink className="size-3" />
          <span>Editar</span>
        </Button>
      </div>

      {state === "loaded" && plugins.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum plugin configurado</p>
      )}

      {state === "error" && <p className="text-xs text-destructive/80">Erro ao ler configuração</p>}

      <div className="flex flex-col gap-1">
        {plugins.map((p) => (
          <div
            key={`${p.type}-${p.name}`}
            className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/10 px-2.5 py-1.5 text-xs"
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                p.status === "connected" ? "bg-emerald-500" : "bg-muted-foreground/40"
              )}
            />
            <div className="min-w-0 flex-1">
              <span className="font-medium">{p.name}</span>
              {p.description && (
                <span className="ml-1 text-muted-foreground/70 truncate">{p.description}</span>
              )}
            </div>
            <span
              className={cn(
                "shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide",
                p.type === "plugin"
                  ? "bg-violet-500/10 text-violet-500"
                  : "bg-blue-500/10 text-blue-500"
              )}
            >
              {p.type === "plugin" ? "plugin" : "mcp"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
