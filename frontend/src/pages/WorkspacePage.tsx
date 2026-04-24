import { ChatPanel } from "@/components/rag/ChatPanel";
import { DataPanel } from "@/components/rag/DataPanel";
import { VisualPanel } from "@/components/rag/VisualPanel";
import { useUpdateWorkspace, useWorkspace } from "@/hooks/useWorkspaces";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type {
  Document,
  DocumentStatus,
  RAGStats,
  UpdateWorkspace,
} from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

const PROCESSING_STATUSES = new Set<DocumentStatus>([
  "parsing",
  "indexing",
  "processing",
]);

export function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const wsId = workspaceId ? Number(workspaceId) : null;

  // -- Workspace data --
  const { data: workspace } = useWorkspace(wsId);
  const updateWorkspace = useUpdateWorkspace();

  // -- Store --
  const { selectedDoc, selectDoc, reset: resetStore } = useWorkspaceStore();

  // Reset store when switching between workspaces
  useEffect(() => {
    resetStore();
  }, [workspaceId, resetStore]);

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------
  const { data: documents, isLoading: docsLoading } = useQuery({
    queryKey: ["documents", workspaceId],
    queryFn: () => api.get<Document[]>(`/documents/workspace/${workspaceId}`),
    enabled: !!workspaceId,
    refetchInterval: (query) => {
      const docs = query.state.data;
      if (docs?.some((d) => PROCESSING_STATUSES.has(d.status))) return 3000;
      return false;
    },
  });

  const { data: ragStats } = useQuery({
    queryKey: ["rag-stats", workspaceId],
    queryFn: () => api.get<RAGStats>(`/rag/stats/${workspaceId}`),
    enabled: !!workspaceId,
  });

  // -----------------------------------------------------------------------
  // Refresh ragStats when processing finishes
  // -----------------------------------------------------------------------
  const processingCount = useMemo(
    () =>
      documents?.filter((d) => PROCESSING_STATUSES.has(d.status)).length ?? 0,
    [documents],
  );

  const prevProcessingRef = useRef(processingCount);
  useEffect(() => {
    if (prevProcessingRef.current > 0 && processingCount === 0) {
      queryClient.invalidateQueries({ queryKey: ["rag-stats", workspaceId] });
    }
    prevProcessingRef.current = processingCount;
  }, [processingCount, queryClient, workspaceId]);

  // Keep selectedDoc in sync with latest document data
  useEffect(() => {
    if (selectedDoc && documents) {
      const updated = documents.find((d) => d.id === selectedDoc.id);
      if (updated && updated.status !== selectedDoc.status) {
        selectDoc(updated);
      }
    }
  }, [documents, selectedDoc, selectDoc]);

  const hasIndexedDocs = (ragStats?.indexed_documents ?? 0) > 0;
  const hasDeepragDocs = (ragStats?.nexusrag_documents ?? 0) > 0;

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------
  const uploadDoc = useMutation({
    mutationFn: ({
      file,
      customMetadata,
    }: {
      file: File;
      customMetadata?: { key: string; value: string }[];
    }) =>
      api.uploadFile<Document>(
        `/documents/upload/${workspaceId}`,
        file,
        customMetadata,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["rag-stats", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Document uploaded successfully");
    },
    onError: () => toast.error("Failed to upload document"),
  });

  const deleteDoc = useMutation({
    mutationFn: (docId: number) => api.delete(`/documents/${docId}`),
    onSuccess: (_, docId) => {
      queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["rag-stats", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      if (selectedDoc?.id === docId) selectDoc(null);
      toast.success("Document deleted");
    },
    onError: () => toast.error("Failed to delete document"),
  });

  const processDoc = useMutation({
    mutationFn: (docId: number) => api.post(`/rag/process/${docId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["rag-stats", workspaceId] });
      toast.info("Analyzing document...", {
        description: "Parsing content and building search index.",
      });
    },
    onError: (error: Error) => {
      if (error.message?.includes("already being analyzed")) {
        toast.info("Document is already being analyzed", {
          description: "Please wait for the current analysis to complete.",
        });
        // Refresh to get latest status
        queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      } else {
        toast.error("Failed to start analysis");
      }
    },
  });

  const reindexDoc = useMutation({
    mutationFn: (docId: number) => api.post(`/rag/reindex/${docId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["rag-stats", workspaceId] });
      toast.success("Document re-processing started");
    },
    onError: () => toast.error("Failed to re-process document"),
  });

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------
  const handleSelectDoc = useCallback(
    (doc: Document) => {
      if (doc.status !== "indexed") return;
      if (selectedDoc?.id === doc.id) {
        selectDoc(null);
      } else {
        selectDoc(doc);
      }
    },
    [selectedDoc, selectDoc],
  );

  const handleUpdateWorkspace = useCallback(
    async (data: UpdateWorkspace) => {
      if (!wsId) return;
      await updateWorkspace.mutateAsync({ id: wsId, data });
    },
    [wsId, updateWorkspace],
  );

  // -----------------------------------------------------------------------
  // Render — 3-column layout
  // -----------------------------------------------------------------------
  return (
    <div className="h-full flex flex-col lg:flex-row gap-6">
      
      {/* Left Column: Knowledge Base Resources */}
      <section className="w-full lg:w-[320px] xl:w-[380px] flex-shrink-0 flex flex-col glass-panel rounded-3xl overflow-hidden shadow-xl border-white/5">
        <div className="p-4 border-b border-white/5 bg-white/2">
          <h3 className="font-display text-lg text-primary">Knowledge Hub</h3>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">Context Engine</p>
        </div>
        <div className="flex-1 overflow-hidden">
          <DataPanel
            workspace={workspace}
            documents={documents}
            docsLoading={docsLoading}
            ragStats={ragStats}
            selectedDocId={selectedDoc?.id ?? null}
            onSelectDoc={handleSelectDoc}
            onUpload={(file, customMetadata) =>
              uploadDoc.mutate({ file, customMetadata })
            }
            isUploading={uploadDoc.isPending}
            onDelete={(id) => deleteDoc.mutate(id)}
            onProcess={(id) => processDoc.mutate(id)}
            onReindex={(id) => reindexDoc.mutate(id)}
            isProcessing={processDoc.isPending}
            onUpdateWorkspace={handleUpdateWorkspace}
          />
        </div>
      </section>

      {/* Right Column: Intelligence & Insights */}
      <div className="flex-1 flex flex-col gap-6 min-w-0 h-full">
        {/* Top: Primary Agent (Chat) */}
        <section className="flex-[3] min-h-0 glass-panel rounded-3xl overflow-hidden shadow-2xl border-white/5 relative group">
          <div className="absolute top-0 right-0 p-4 z-10 pointer-events-none transition-opacity group-hover:opacity-100 opacity-50">
             <div className="bg-primary/10 border border-primary/20 rounded-full px-3 py-1 backdrop-blur-md">
                <span className="text-[9px] text-primary font-bold uppercase tracking-widest">Active Reasoning</span>
             </div>
          </div>
          <ChatPanel
            workspaceId={workspaceId || ""}
            hasIndexedDocs={hasIndexedDocs}
            workspace={workspace ?? null}
          />
        </section>

        {/* Bottom: Insight Visualization (Graph) */}
        <section className="flex-[2] min-h-0 glass-panel rounded-3xl overflow-hidden shadow-lg border-white/5">
          <VisualPanel
            workspaceId={workspaceId || ""}
            hasDeepragDocs={hasDeepragDocs}
          />
        </section>
      </div>

    </div>
  );
}
