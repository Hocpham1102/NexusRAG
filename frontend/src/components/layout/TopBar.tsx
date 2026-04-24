import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChevronRight, Cpu, Database, RadioTower, WifiOff } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

interface ConfigStatus {
  llm_provider: string;
  llm_model: string;
  ollama_status?: {
    available: boolean;
    status: "online" | "offline" | "not_used";
    message: string;
  };
  kg_embedding_provider: string;
  kg_embedding_model: string;
  kg_embedding_dimension: number;
  nexusrag_embedding_model: string;
  nexusrag_reranker_model: string;
}

interface TopBarProps {
  actions?: React.ReactNode;
  className?: string;
}

export const TopBar = memo(function TopBar({
  actions,
  className,
}: TopBarProps) {
  const location = useLocation();
  const [config, setConfig] = useState<ConfigStatus | null>(null);

  useEffect(() => {
    let alive = true;

    const loadConfig = () => {
      api
        .get<ConfigStatus>("/config/status")
        .then((data) => {
          if (alive) setConfig(data);
        })
        .catch(() => {});
    };

    loadConfig();
    const interval = window.setInterval(loadConfig, 15000);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, []);

  const segments: { label: string; active: boolean }[] = [
    { label: "NexusRAG", active: false },
  ];

  if (location.pathname === "/") {
    segments.push({ label: "Knowledge Bases", active: true });
  } else if (location.pathname.startsWith("/knowledge-bases/")) {
    segments.push({ label: "Workspace", active: true });
  }

  return (
    <div
      className={cn(
        "h-16 flex items-center justify-between px-4 md:px-6 border-b border-border/70 shrink-0 bg-card/68 backdrop-blur-xl",
        className,
      )}
    >
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80 shrink-0" />
            )}
            <span
              className={cn(
                "truncate px-2.5 py-1 rounded-lg border text-xs md:text-sm",
                seg.active
                  ? "font-semibold text-foreground border-primary/35 bg-primary/10"
                  : "text-muted-foreground border-border/60 bg-background/55",
              )}
            >
              {seg.label}
            </span>
          </div>
        ))}
      </div>

      {/* Right-side: model badges + actions */}
      <div className="flex items-center gap-2 shrink-0">
        {config && (
          <div className="hidden md:flex items-center gap-1.5">
            {config.ollama_status?.status === "offline" && (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border bg-destructive/10 text-destructive border-destructive/25"
                title={config.ollama_status.message}
              >
                <WifiOff className="w-3 h-3" />
                <span>Ollama offline</span>
              </div>
            )}
            {config.ollama_status?.status === "online" && (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                title={config.ollama_status.message}
              >
                <RadioTower className="w-3 h-3" />
                <span>Ollama online</span>
              </div>
            )}
            <div
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border",
                config.llm_provider === "ollama"
                  ? "bg-primary/12 text-primary border-primary/30"
                  : "bg-accent/18 text-accent-foreground border-accent/25",
              )}
              title={`LLM: ${config.llm_provider} / ${config.llm_model}`}
            >
              <Cpu className="w-3 h-3" />
              <span className="max-w-47.5 truncate">{config.llm_model}</span>
            </div>
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border bg-background/75 text-muted-foreground border-border/70"
              title={`KG Embedding: ${config.kg_embedding_provider} / ${config.kg_embedding_model} (${config.kg_embedding_dimension}d)`}
            >
              <Database className="w-3 h-3" />
              <span className="max-w-47.5 truncate">
                {config.kg_embedding_model}
              </span>
            </div>
          </div>
        )}
        {actions}
      </div>
    </div>
  );
});
