"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Search,
  ShoppingBag,
  Download,
  ExternalLink,
  Info,
  CheckCircle2,
  Server,
  Terminal,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Plugin {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: "MCP" | "Skill" | "API";
  installed: boolean;
  author: string;
  stars: number;
  installs: string;
  category: string;
}

const CATEGORIES = ["All", "Official", "Database", "Development", "Browser", "Productivity"];

export function StorePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    void handleSync();
  }, []);

  const filteredPlugins = useMemo(() => {
    return plugins.filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = activeCategory === "All" || p.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [plugins, searchQuery, activeCategory]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      // Curated list of official and known MCP servers
      const officialPlugins: Plugin[] = [
        {
          id: "gh-mcp",
          name: "GitHub Official",
          author: "Anthropic",
          category: "Official",
          description: "Manage repositories, issues, and PRs via Claude.",
          icon: "🐙",
          type: "MCP",
          installed: false,
          stars: 5.0,
          installs: "50k"
        },
        {
          id: "slack-mcp",
          name: "Slack Official",
          author: "Anthropic",
          category: "Official",
          description: "Query history and send messages in Slack channels.",
          icon: "💬",
          type: "MCP",
          installed: false,
          stars: 4.9,
          installs: "42k"
        },
        {
          id: "gdrive-mcp",
          name: "Google Drive",
          author: "Anthropic",
          category: "Official",
          description: "Search, read and manage documents in your Workspace.",
          icon: "📂",
          type: "MCP",
          installed: false,
          stars: 4.8,
          installs: "35k"
        },
        {
          id: "pg-mcp",
          name: "PostgreSQL MCP",
          author: "Anthropic",
          category: "Database",
          description: "Access and query your PostgreSQL databases directly.",
          icon: "🗄️",
          type: "MCP",
          installed: false,
          stars: 4.9,
          installs: "5.2k"
        },
        {
          id: "brave-search",
          name: "Brave Search",
          author: "Brave",
          category: "Browser",
          description: "Real-time web search capabilities for your agents.",
          icon: "🔍",
          type: "MCP",
          installed: false,
          stars: 4.8,
          installs: "8.4k"
        }
      ];

      // Simulating API fetch delay
      await new Promise((resolve) => setTimeout(resolve, 800));
      setPlugins(officialPlugins);
    } catch (error) {
      console.error("Failed to sync plugins:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleInstall = (id: string) => {
    setPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, installed: !p.installed } : p)));
  };

  return (
    <div className="flex h-full flex-col bg-background p-6 lg:p-10 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-10 pb-20">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                <ShoppingBag className="size-5" />
              </div>
              <h1 className="text-4xl font-extrabold tracking-tight">Store</h1>
            </div>
            <p className="text-lg text-muted-foreground max-w-lg">
              The central hub for extending your agents with MCP servers, specialized skills, and
              external APIs.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className={cn(
                "h-11 px-5 rounded-xl font-semibold transition-all",
                isSyncing && "animate-pulse"
              )}
              onClick={() => void handleSync()}
              disabled={isSyncing}
            >
              <Zap
                className={cn(
                  "size-4 mr-2",
                  isSyncing ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"
                )}
              />
              {isSyncing ? "Syncing Registry..." : "Sync Registry"}
            </Button>
            <Button className="h-11 px-6 rounded-xl font-bold shadow-md shadow-primary/20">
              Submit Plugin
            </Button>
          </div>
        </div>

        {/* Filters and Search */}
        <div className="flex flex-col sm:flex-row items-center gap-4 bg-card/50 p-2 rounded-2xl border border-border/40 backdrop-blur-sm">
          <div className="relative flex-1 w-full group">
            <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              placeholder="Search by name, author or functionality..."
              className="h-12 w-full rounded-xl border-none bg-transparent pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/60"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 px-2 no-scrollbar">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all",
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Featured Section */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Zap className="size-5 text-yellow-500 fill-yellow-500" />
              Community Favorites
            </h2>
            <Button variant="link" className="text-primary font-bold">
              View all
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPlugins.map((plugin) => (
              <div
                key={plugin.id}
                className="group relative flex flex-col rounded-2xl border border-border/60 bg-card p-6 transition-all hover:shadow-xl hover:shadow-primary/5 hover:border-primary/30 hover:-translate-y-1"
              >
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-3xl shadow-inner group-hover:scale-110 transition-transform duration-300">
                    {plugin.icon}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        plugin.type === "MCP"
                          ? "bg-blue-500/10 text-blue-500"
                          : plugin.type === "Skill"
                            ? "bg-purple-500/10 text-purple-500"
                            : "bg-green-500/10 text-green-500"
                      )}
                    >
                      {plugin.type}
                    </span>
                    <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                      <span>⭐ {plugin.stars}</span>
                      <span>•</span>
                      <span>{plugin.installs}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <h3 className="text-lg font-extrabold group-hover:text-primary transition-colors">
                    {plugin.name}
                  </h3>
                  <p className="text-xs font-medium text-muted-foreground">by {plugin.author}</p>
                </div>

                <p className="mt-4 text-sm text-muted-foreground/80 leading-relaxed line-clamp-2">
                  {plugin.description}
                </p>

                <div className="mt-8 flex items-center gap-2 pt-5 border-t border-border/30">
                  <Button
                    size="sm"
                    className={cn(
                      "h-9 flex-1 rounded-xl font-bold transition-all",
                      plugin.installed
                        ? "bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        : "bg-primary text-primary-foreground hover:opacity-90 active:scale-95"
                    )}
                    onClick={() => toggleInstall(plugin.id)}
                  >
                    {plugin.installed ? (
                      <>
                        <CheckCircle2 className="size-3.5 mr-2 group-hover:hidden" />
                        <span className="group-hover:hidden">Installed</span>
                        <span className="hidden group-hover:inline">Uninstall</span>
                      </>
                    ) : (
                      <>
                        <Download className="size-3.5 mr-2" />
                        Install
                      </>
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-9 rounded-xl hover:bg-secondary"
                  >
                    <Info className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Empty State */}
        {!isSyncing && filteredPlugins.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 bg-muted/20 rounded-3xl border-2 border-dashed border-border">
            <div className="size-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
              <Search className="size-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-bold">No plugins found</h3>
              <p className="text-muted-foreground">Try adjusting your search or filters.</p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery("");
                setActiveCategory("All");
              }}
            >
              Clear All Filters
            </Button>
          </div>
        )}

        {/* Marketplace Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-10">
          <div className="p-6 rounded-2xl bg-blue-500/5 border border-blue-500/10 space-y-3">
            <Server className="size-6 text-blue-500" />
            <h4 className="font-bold">What is MCP?</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Model Context Protocol allows agents to connect to secure data sources like databases,
              local files, or APIs with universal standards.
            </p>
          </div>
          <div className="p-6 rounded-2xl bg-purple-500/5 border border-purple-500/10 space-y-3">
            <Terminal className="size-6 text-purple-500" />
            <h4 className="font-bold">Agent Skills</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Skills are specialized JavaScript or Python workflows that give your agents new
              capabilities like advanced Git management or PDF parsing.
            </p>
          </div>
          <div className="p-6 rounded-2xl bg-green-500/5 border border-green-500/10 space-y-3">
            <ExternalLink className="size-6 text-green-500" />
            <h4 className="font-bold">Third-party APIs</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Directly integrate with the services you use every day, from Slack and Discord to
              Stripe and Google Workspace.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
