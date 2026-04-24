import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  useCreateWorkspace,
  useDeleteWorkspace,
  useWorkspaces,
} from "@/hooks/useWorkspaces";
import type { KnowledgeBase } from "@/types";
import {
  Database,
  FileText,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export function KnowledgeBasesPage() {
  const navigate = useNavigate();
  const { data: workspaces, isLoading } = useWorkspaces();
  const createWorkspace = useCreateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [openMenu, setOpenMenu] = useState<number | null>(null);

  // Close menu on outside click
  useEffect(() => {
    if (openMenu === null) return;
    const close = () => setOpenMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenu]);

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    try {
      const ws = await createWorkspace.mutateAsync({ name: newWorkspaceName });
      toast.success("Knowledge base created");
      setNewWorkspaceName("");
      setShowNewWorkspace(false);
      navigate(`/knowledge-bases/${ws.id}`);
    } catch {
      toast.error("Failed to create knowledge base");
    }
  };

  const handleDeleteWorkspace = async (id: number) => {
    try {
      await deleteWorkspace.mutateAsync(id);
      toast.success("Knowledge base deleted");
    } catch {
      toast.error("Failed to delete knowledge base");
    }
    setDeleteConfirm(null);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="h-full overflow-y-auto px-5 md:px-7 pb-8">
      <div className="max-w-6xl mx-auto pt-7">
        <section className="relative overflow-hidden rounded-xl glass-panel px-6 md:px-8 py-7 md:py-12 mb-7">
          <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-16 w-56 h-56 rounded-full bg-accent/20 blur-3xl pointer-events-none" />

          <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] uppercase tracking-[0.2em] text-primary font-bold mb-2">
                Quantum Intelligence
              </p>
              <h2 className="text-3xl md:text-5xl font-display leading-tight tracking-tight">
                Deep Knowledge collections with <span className="text-primary">Agentic Reasoning</span>.
              </h2>
              <p className="text-sm text-muted-foreground mt-4 leading-relaxed max-w-xl">
                NexusRAG merges vector search, knowledge graphs, and cross-encoder reranking into a seamless pipeline.
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="rounded-xl border border-border/30 bg-background/20 backdrop-blur-md px-5 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
                  Active Collections
                </p>
                <p className="text-2xl font-display tabular-nums text-primary">
                  {workspaces?.length ?? 0}
                </p>
              </div>
              <Button
                onClick={() => setShowNewWorkspace(true)}
                size="sm"
                className="btn-primary h-12 px-6 rounded-xl text-sm font-semibold"
              >
                <Plus className="w-5 h-5 mr-2" />
                Create Collection
              </Button>
            </div>
          </div>
        </section>

        {/* New Workspace Modal */}
        {showNewWorkspace && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <Card className="w-full max-w-md mx-4 shadow-2xl rounded-2xl border-border/80 bg-card/95 backdrop-blur-xl">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold tracking-tight">
                    New Knowledge Base
                  </h3>
                  <button
                    onClick={() => setShowNewWorkspace(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <Input
                  placeholder="Knowledge base name"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleCreateWorkspace()
                  }
                  autoFocus
                  className="h-11"
                />
                <div className="flex justify-end gap-2 mt-4">
                  <Button
                    variant="ghost"
                    onClick={() => setShowNewWorkspace(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateWorkspace}
                    disabled={
                      createWorkspace.isPending || !newWorkspaceName.trim()
                    }
                  >
                    {createWorkspace.isPending ? "Creating..." : "Create"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {[1, 2].map((i) => (
              <Card
                key={i}
                className="animate-pulse rounded-2xl border-border/70 bg-card/70"
              >
                <CardContent className="pt-5 pb-5">
                  <div className="h-5 bg-muted rounded w-2/3 mb-3" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !workspaces || workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 rounded-[28px] border border-dashed border-border/80 bg-card/55">
            <div className="w-20 h-20 rounded-3xl bg-primary/12 flex items-center justify-center mb-6 border border-primary/25">
              <Database className="w-10 h-10 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2 tracking-tight">
              Create your first knowledge base
            </h3>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              Knowledge bases store your documents and enable AI-powered search
              across them. Link them to any project as a data source.
            </p>
            <Button
              onClick={() => setShowNewWorkspace(true)}
              size="lg"
              className="rounded-xl px-6"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Knowledge Base
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Dashboard Grid */}
            {/* Featured Card */}
          {workspaces && workspaces.length > 0 && (
            <div 
              className="lg:col-span-2 rounded-3xl glass-panel p-8 min-h-[400px] flex flex-col justify-between group cursor-pointer border-primary/20 relative overflow-hidden"
              onClick={() => navigate(`/knowledge-bases/${workspaces[0].id}`)}
            >
              <div className="absolute top-0 right-0 p-8">
                <Database className="w-24 h-24 text-primary/10 group-hover:text-primary/20 transition-all duration-500 rotate-12 group-hover:rotate-0" />
              </div>
              <div>
                <span className="bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border border-primary/20">Featured Collection</span>
                <h2 className="text-4xl font-display mt-6 group-hover:text-primary transition-colors">{workspaces[0].name}</h2>
                <p className="text-muted-foreground mt-4 max-w-md line-clamp-2">{workspaces[0].description || "No description provided for this collection."}</p>
              </div>
              <div className="flex items-center gap-6 mt-8">
                 <div className="text-center">
                    <p className="text-2xl font-display text-primary">{workspaces[0].document_count}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-tighter">Documents</p>
                 </div>
                 <div className="w-px h-8 bg-white/10" />
                 <div className="text-center">
                    <p className="text-2xl font-display text-accent">{workspaces[0].indexed_count}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-tighter">Indexed Chunks</p>
                 </div>
                 <Button className="ml-auto btn-primary rounded-xl">Open Intelligence</Button>
              </div>
            </div>
          )}

          {/* Create New / Secondary Column */}
          <div className="flex flex-col gap-6">
             <div 
              className="flex-1 rounded-3xl glass-card p-6 flex flex-col items-center justify-center text-center group cursor-pointer border-dashed border-white/10"
              onClick={() => setShowNewWorkspace(true)}
             >
                <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center group-hover:scale-110 group-hover:bg-primary/10 transition-all duration-300">
                  <Plus className="w-8 h-8 text-primary" />
                </div>
                <h3 className="font-display text-lg mt-4">New Collection</h3>
                <p className="text-xs text-muted-foreground mt-2">Initialize a new knowledge base</p>
             </div>
          </div>

          {/* Remaining Collections in a tighter grid */}
          <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
            {workspaces?.slice(1).map((ws: KnowledgeBase) => (
              <div
                key={ws.id}
                className="group cursor-pointer rounded-2xl glass-card p-5 border-white/5 hover:border-primary/20"
                onClick={() => navigate(`/knowledge-bases/${ws.id}`)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                    <Database className="w-5 h-5 text-muted-foreground group-hover:text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-semibold text-sm truncate">{ws.name}</h4>
                    <p className="text-[10px] text-muted-foreground">{ws.document_count} files</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteConfirm !== null}
        onConfirm={() =>
          deleteConfirm !== null && handleDeleteWorkspace(deleteConfirm)
        }
        onCancel={() => setDeleteConfirm(null)}
        title="Delete Knowledge Base"
        message="Are you sure? All documents, indexed data, and knowledge graph data will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
