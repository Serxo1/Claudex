import { create } from "zustand";

const RULES_KEY = "always-allow-rules";

export type AllowRule = {
  tool: string;
  pattern?: string; // e.g. "npm *" para Bash; undefined = qualquer input desta tool
  label: string; // texto mostrado na UI
};

function loadRules(): AllowRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    return raw ? (JSON.parse(raw) as AllowRule[]) : [];
  } catch {
    return [];
  }
}

function saveRules(rules: AllowRule[]) {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    // ignore
  }
}

/** Verifica se o valor começa com o prefixo do padrão "word *" */
function matchPattern(pattern: string, value: string): boolean {
  if (pattern.endsWith(" *")) {
    const prefix = pattern.slice(0, -2);
    return value === prefix || value.startsWith(`${prefix} `);
  }
  return value === pattern;
}

type PermissionsState = {
  rules: AllowRule[];
  addRule: (rule: AllowRule) => void;
  removeRule: (tool: string, pattern?: string) => void;
  matchesRule: (tool: string, input: Record<string, unknown>) => boolean;
};

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  rules: loadRules(),

  addRule: (rule) => {
    set((state) => {
      // Evita duplicados
      const filtered = state.rules.filter(
        (r) => !(r.tool === rule.tool && r.pattern === rule.pattern)
      );
      const rules = [...filtered, rule];
      saveRules(rules);
      return { rules };
    });
  },

  removeRule: (tool, pattern) => {
    set((state) => {
      const rules = state.rules.filter((r) => !(r.tool === tool && r.pattern === pattern));
      saveRules(rules);
      return { rules };
    });
  },

  matchesRule: (tool, input) => {
    const { rules } = get();
    return rules.some((rule) => {
      if (rule.tool !== tool) return false;
      // Sem padrão → aprovação total para esta tool
      if (!rule.pattern) return true;
      // Com padrão → comparar contra o campo command (Bash)
      const cmd = typeof input.command === "string" ? input.command.trim() : "";
      return matchPattern(rule.pattern, cmd);
    });
  }
}));

/**
 * Deriva a regra sugerida para o botão "Sempre permitir".
 * - Bash: usa o primeiro comando (e.g. "npm *", "git *")
 * - Outras tools: aprovação total da tool
 */
export function deriveAllowRule(
  toolName: string,
  input: Record<string, unknown>
): AllowRule | null {
  if (toolName === "Bash") {
    const cmd = typeof input.command === "string" ? input.command.trim() : "";
    const firstWord = cmd.split(/\s+/)[0];
    if (!firstWord) return null;
    const pattern = `${firstWord} *`;
    return { tool: "Bash", pattern, label: pattern };
  }

  // Para tools de ficheiros e outras: aprovação total da tool
  const fileTools = ["Write", "Edit", "MultiEdit", "Read", "Glob", "Grep", "LS"];
  if (fileTools.includes(toolName)) {
    return { tool: toolName, pattern: undefined, label: `sempre ${toolName}` };
  }

  return null;
}
