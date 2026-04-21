import { useState } from "react";
import {
  useGetLineage,
  useGenerateLineage,
  useEnhanceLineageAI,
  useEnhanceLineageAIBulk,
  useRefreshLineageAICache,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  GitMerge,
  RefreshCw,
  ChevronRight,
  Database,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Sparkles,
  Trash2,
  BrainCircuit,
} from "lucide-react";

function getMethodColor(method: string) {
  switch (method.toUpperCase()) {
    case "GET":    return "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
    case "POST":   return "text-blue-500 bg-blue-500/10 border-blue-500/20";
    case "PUT":    return "text-amber-500 bg-amber-500/10 border-amber-500/20";
    case "DELETE": return "text-red-500 bg-red-500/10 border-red-500/20";
    case "PATCH":  return "text-purple-500 bg-purple-500/10 border-purple-500/20";
    default:       return "text-muted-foreground bg-muted/10 border-muted/20";
  }
}

function getOperationColor(op: string) {
  switch (op.toUpperCase()) {
    case "SELECT": return "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
    case "INSERT": return "text-blue-400 bg-blue-400/10 border-blue-400/20";
    case "UPDATE": return "text-amber-400 bg-amber-400/10 border-amber-400/20";
    case "DELETE": return "text-red-400 bg-red-400/10 border-red-400/20";
    default:       return "text-muted-foreground bg-muted/10 border-muted/20";
  }
}

function getConfidenceLevelColor(level: string | undefined) {
  switch ((level ?? "").toLowerCase()) {
    case "high":     return "text-emerald-500 bg-emerald-500/10 border-emerald-500/30";
    case "medium":   return "text-amber-400 bg-amber-400/10 border-amber-400/30";
    case "low":      return "text-orange-400 bg-orange-400/10 border-orange-400/30";
    case "conflict": return "text-red-500 bg-red-500/10 border-red-500/30";
    default:         return "text-muted-foreground bg-muted/10 border-border/30";
  }
}

function getSourceColor(source: string | undefined) {
  switch ((source ?? "").toLowerCase()) {
    case "merged":        return "text-violet-400 bg-violet-400/10 border-violet-400/30";
    case "llm":           return "text-sky-400 bg-sky-400/10 border-sky-400/30";
    case "deterministic": return "text-muted-foreground bg-muted/10 border-border/30";
    default:              return "text-muted-foreground bg-muted/10 border-border/30";
  }
}

function SourceLabel({ source }: { source: string | undefined }) {
  if (!source || source === "deterministic") return null;
  const label = source === "llm" ? "AI" : source === "merged" ? "AI+AST" : source;
  return (
    <span className={cn("font-mono text-[9px] tracking-widest uppercase border px-1.5 py-0.5", getSourceColor(source))}>
      {label}
    </span>
  );
}

function ConfidenceLevelBadge({ level }: { level: string | undefined }) {
  if (!level) return null;
  return (
    <span className={cn("font-mono text-[9px] tracking-widest uppercase border px-1.5 py-0.5", getConfidenceLevelColor(level))}>
      {level}
    </span>
  );
}

function ConfidenceDot({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 90 ? "bg-emerald-500" :
    pct >= 70 ? "bg-amber-400" :
    "bg-muted-foreground";
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground" title={`${pct}% confidence`}>
      <span className={cn("inline-block w-2 h-2 rounded-full", color)} />
      {pct}%
    </span>
  );
}

function StatusIcon({ status }: { status: "mapped" | "partial" | "unknown" }) {
  if (status === "mapped")   return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
  if (status === "partial")  return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
  return <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />;
}

interface Props {
  projectId: string;
}

export function LineageTab({ projectId }: Props) {
  const [hasTriggered, setHasTriggered] = useState(false);
  const [enhancingIds, setEnhancingIds] = useState<Set<string>>(new Set());
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const { data, isLoading, refetch } = useGetLineage({ projectId }, { enabled: true });
  const { mutate: generate, isPending: isGenerating } = useGenerateLineage({
    mutation: {
      onSuccess: () => {
        setHasTriggered(true);
        void refetch();
      },
    },
  });

  const { mutate: enhanceSingle } = useEnhanceLineageAI({
    mutation: {
      onSuccess: () => void refetch(),
      onSettled: (_data, _err, vars) => {
        setEnhancingIds((prev) => {
          const next = new Set(prev);
          next.delete((vars.data as { apiId?: string }).apiId ?? "");
          return next;
        });
      },
    },
  });

  const { mutate: enhanceBulk, isPending: isBulking } = useEnhanceLineageAIBulk({
    mutation: {
      onSuccess: (result) => {
        setBulkMsg(`Enhanced ${result.enhanced}/${result.processed} APIs`);
        void refetch();
        setTimeout(() => setBulkMsg(null), 4000);
      },
    },
  });

  const { mutate: refreshCache, isPending: isRefreshing } = useRefreshLineageAICache({
    mutation: {
      onSuccess: (result) => {
        setBulkMsg(`Cache cleared — ${result.evicted} entries evicted`);
        setTimeout(() => setBulkMsg(null), 3000);
      },
    },
  });

  const hasData = data && data.entries.length > 0;
  const isEmpty = !isLoading && !hasData;
  const isBusy = isGenerating || isBulking || isRefreshing;

  const handleEnhanceSingle = (apiId: string) => {
    setEnhancingIds((prev) => new Set(prev).add(apiId));
    enhanceSingle({ data: { projectId, apiId } });
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          {hasData && (
            <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                {data.mappedCount} mapped
              </span>
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                {data.partialCount} partial
              </span>
              {data.unknownCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <HelpCircle className="w-3 h-3 text-muted-foreground" />
                  {data.unknownCount} unknown
                </span>
              )}
            </div>
          )}
          {bulkMsg && (
            <span className="font-mono text-[10px] text-emerald-400 border border-emerald-400/20 px-2 py-1">
              {bulkMsg}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasData && (
            <>
              <button
                onClick={() => refreshCache({ data: { projectId } })}
                disabled={isBusy}
                title="Clear AI response cache and force re-generation on next enhance"
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider border transition-all",
                  isBusy
                    ? "border-border/30 text-muted-foreground cursor-not-allowed"
                    : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border cursor-pointer",
                )}
              >
                <Trash2 className={cn("w-3 h-3", isRefreshing && "animate-spin")} />
                {isRefreshing ? "Clearing..." : "Refresh Cache"}
              </button>
              <button
                onClick={() => enhanceBulk({ data: { projectId } })}
                disabled={isBusy}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider border transition-all",
                  isBusy
                    ? "border-border/30 text-muted-foreground cursor-not-allowed"
                    : "border-violet-500/40 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500 cursor-pointer",
                )}
              >
                <BrainCircuit className={cn("w-3 h-3", isBulking && "animate-pulse")} />
                {isBulking ? "Enhancing all..." : "Bulk AI Enhance"}
              </button>
            </>
          )}
          <button
            onClick={() => generate({ data: { projectId } })}
            disabled={isBusy}
            className={cn(
              "flex items-center gap-2 px-4 py-2 font-mono text-xs uppercase tracking-wider border transition-all",
              isBusy
                ? "border-border/30 text-muted-foreground cursor-not-allowed"
                : "border-primary/40 text-primary hover:bg-primary/10 hover:border-primary cursor-pointer",
            )}
          >
            <RefreshCw className={cn("w-3 h-3", isGenerating && "animate-spin")} />
            {isGenerating ? "Mapping lineage..." : hasData ? "Re-run Lineage" : "Generate Lineage"}
          </button>
        </div>
      </div>

      {/* Loading */}
      {(isLoading || isGenerating) && (
        <div className="p-12 flex flex-col items-center justify-center text-muted-foreground font-mono text-sm animate-pulse border border-dashed border-border/30">
          <GitMerge className="w-8 h-8 mb-4 opacity-50" />
          [TRACING API ↔ DB CONNECTIONS...]
        </div>
      )}

      {/* Empty state */}
      {isEmpty && !isGenerating && (
        <div className="p-12 flex flex-col items-center justify-center text-muted-foreground font-mono text-sm border border-dashed border-border/30">
          <GitMerge className="w-8 h-8 mb-4 opacity-30" />
          <div className="text-center space-y-1">
            <div>NO LINEAGE DATA FOUND</div>
            <div className="text-xs opacity-60">Run "Generate Lineage" to map API endpoints to database tables</div>
          </div>
        </div>
      )}

      {/* Lineage cards */}
      {hasData && !isGenerating && (
        <div className="grid gap-3">
          {data.entries.map((entry) => {
            const isEnhancing = enhancingIds.has(entry.api.id);
            const hasAITables = entry.tables.some(
              (t) => t.source === "llm" || t.source === "merged",
            );
            return (
              <Card
                key={entry.api.id}
                className={cn(
                  "border rounded-none transition-colors",
                  entry.status === "mapped"  && "border-emerald-500/20 bg-emerald-500/[0.03]",
                  entry.status === "partial" && "border-amber-400/20 bg-amber-400/[0.03]",
                  entry.status === "unknown" && "border-border/40 bg-card/40",
                  isEnhancing && "border-violet-500/30 bg-violet-500/[0.03]",
                )}
              >
                <CardHeader className="pb-3 pt-4 px-5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2.5">
                      <Badge
                        variant="outline"
                        className={cn("rounded-none font-mono text-[10px] tracking-wider uppercase border px-2", getMethodColor(entry.api.method))}
                      >
                        {entry.api.method}
                      </Badge>
                      <CardTitle className="font-mono text-sm text-foreground">{entry.api.path}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasAITables && (
                        <span className="flex items-center gap-1 font-mono text-[9px] text-violet-400 uppercase border border-violet-400/20 px-1.5 py-0.5">
                          <Sparkles className="w-2.5 h-2.5" />
                          AI enhanced
                        </span>
                      )}
                      <StatusIcon status={entry.status} />
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">{entry.status}</span>
                      <button
                        onClick={() => handleEnhanceSingle(entry.api.id)}
                        disabled={isBusy || isEnhancing}
                        title="Enhance this mapping using RAG + LLM"
                        className={cn(
                          "flex items-center gap-1 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider border transition-all",
                          isEnhancing
                            ? "border-violet-500/30 text-violet-400 cursor-wait animate-pulse"
                            : isBusy
                              ? "border-border/20 text-muted-foreground/40 cursor-not-allowed"
                              : "border-violet-500/30 text-violet-400/70 hover:text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/60 cursor-pointer",
                        )}
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                        {isEnhancing ? "Enhancing..." : "Enhance with AI"}
                      </button>
                    </div>
                  </div>
                  {entry.api.handler && (
                    <div className="font-mono text-[10px] text-muted-foreground/60 ml-0.5">{entry.api.handler}</div>
                  )}
                </CardHeader>

                <CardContent className="px-5 pb-4 space-y-4">
                  {/* Flow chain */}
                  {entry.flow.length > 0 && (
                    <div>
                      <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest mb-2">Flow</div>
                      <div className="flex flex-wrap items-center gap-1">
                        {entry.flow.map((step, i) => (
                          <span key={i} className="flex items-center gap-1">
                            <span className="font-mono text-xs bg-muted/20 border border-border/30 px-2 py-0.5 text-foreground/80">
                              {step}
                            </span>
                            {i < entry.flow.length - 1 && (
                              <ChevronRight className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tables */}
                  {entry.tables.length > 0 ? (
                    <div>
                      <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest mb-2">
                        Tables ({entry.tables.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {entry.tables.map((t, i) => (
                          <div
                            key={i}
                            className={cn(
                              "flex items-center gap-2 border px-2.5 py-1.5",
                              t.confidence_level === "conflict"
                                ? "bg-red-500/[0.04] border-red-500/20"
                                : t.source === "llm"
                                  ? "bg-sky-500/[0.04] border-sky-400/20"
                                  : t.source === "merged"
                                    ? "bg-violet-500/[0.04] border-violet-400/20"
                                    : "bg-muted/10 border-border/30",
                            )}
                          >
                            <Database className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
                            <span className="font-mono text-xs text-foreground">{t.name}</span>
                            <Badge
                              variant="outline"
                              className={cn("rounded-none font-mono text-[9px] tracking-widest uppercase border px-1.5 py-0", getOperationColor(t.operation))}
                            >
                              {t.operation}
                            </Badge>
                            <ConfidenceDot confidence={t.confidence} />
                            <ConfidenceLevelBadge level={t.confidence_level} />
                            <SourceLabel source={t.source} />
                            {t.prompt_version && (
                              <span className="font-mono text-[9px] text-muted-foreground/40">
                                {t.prompt_version}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] font-mono text-muted-foreground/50 italic">
                      No table mappings detected
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
