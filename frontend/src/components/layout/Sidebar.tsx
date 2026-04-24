import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Database } from "lucide-react";
import { memo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export const Sidebar = memo(function Sidebar({
  collapsed,
  onToggle,
}: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: workspaces } = useWorkspaces();

  const activeWorkspaceId = location.pathname.match(
    /\/knowledge-bases\/(\d+)/,
  )?.[1];
  const isHome = location.pathname === "/";

  return (
    <aside
      className={cn(
        "flex flex-col h-full border-r border-border/80 transition-all duration-300 flex-shrink-0 bg-background/75 backdrop-blur-xl",
        collapsed ? "w-16" : "w-72",
      )}
    >
      {/* Logo */}
      <div className="px-3 py-3 border-b border-border/75 flex-shrink-0">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-2xl border border-border/70 bg-card/80">
          <div className="w-9 h-9 rounded-2xl bg-primary/16 border border-primary/35 flex items-center justify-center shadow-[inset_0_0_0_1px_oklch(0.98_0.01_90_/_0.04)]">
            <Database className="w-4 h-4 text-primary flex-shrink-0" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="font-semibold text-[15px] tracking-tight text-foreground truncate">
                NexusRAG
              </p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
                Research Console
              </p>
            </div>
          )}
          {!collapsed && (
            <div className="ml-auto rounded-lg border border-border/70 bg-background/70 px-2 py-1 text-[10px] text-muted-foreground">
              v2
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-shrink-0 px-2.5 pt-3 space-y-2">
        <button
          onClick={() => navigate("/")}
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all border",
            isHome && !activeWorkspaceId
              ? "bg-primary/14 text-primary font-medium border-primary/35"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground border-border/60 bg-card/55",
          )}
          title={collapsed ? "Knowledge Bases" : undefined}
        >
          <Database className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span className="truncate">Knowledge Bases</span>}
          {!collapsed && (
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-md border border-border/60 bg-background/80">
              {workspaces?.length ?? 0}
            </span>
          )}
        </button>
      </nav>

      {/* Scrollable workspace list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {!collapsed && workspaces && workspaces.length > 0 && (
          <div className="mt-4 px-2.5">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80 mb-2">
              Recent Workspaces
            </p>
            <div className="space-y-1.5">
              {workspaces.slice(0, 20).map((ws) => {
                const isActive = activeWorkspaceId === String(ws.id);
                return (
                  <button
                    key={ws.id}
                    onClick={() => navigate(`/knowledge-bases/${ws.id}`)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all border",
                      isActive
                        ? "bg-primary/12 text-primary border-primary/35 font-medium"
                        : "border-border/60 bg-card/55 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <Database className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{ws.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground/80 tabular-nums bg-background/75 px-1.5 py-0.5 rounded-md border border-border/60">
                      {ws.document_count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Collapsed indicators */}
        {collapsed && (
          <div className="mt-4 px-2.5 space-y-1.5">
            {workspaces?.slice(0, 7).map((ws) => {
              const isActive = activeWorkspaceId === String(ws.id);
              return (
                <button
                  key={`ws-${ws.id}`}
                  onClick={() => navigate(`/knowledge-bases/${ws.id}`)}
                  className={cn(
                    "w-full flex items-center justify-center py-2.5 rounded-xl transition-colors border",
                    isActive
                      ? "bg-primary/15 text-primary border-primary/35"
                      : "text-muted-foreground hover:bg-muted/60 border-border/60 bg-card/45",
                  )}
                  title={ws.name}
                >
                  <Database className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-border/75 px-2.5 py-2.5 flex items-center justify-between bg-card/55">
        <ThemeToggle />
        <button
          onClick={onToggle}
          className="w-8 h-8 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors border border-border/60"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>
    </aside>
  );
});
