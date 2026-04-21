import { useState } from "react";
import { useGenerateHld, useGetHld, useRefreshHld } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, RefreshCw, Download, Layers, Database, ArrowRight, GitBranch, Sparkles, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface HldTabProps {
  projectId: string;
}

const MODULE_COLORS = [
  "border-l-cyan-500 bg-cyan-500/5",
  "border-l-violet-500 bg-violet-500/5",
  "border-l-emerald-500 bg-emerald-500/5",
  "border-l-amber-500 bg-amber-500/5",
  "border-l-rose-500 bg-rose-500/5",
  "border-l-blue-500 bg-blue-500/5",
  "border-l-fuchsia-500 bg-fuchsia-500/5",
];

function getMethodColor(method: string) {
  const m = method.toUpperCase();
  if (m === "GET") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  if (m === "POST") return "text-blue-400 bg-blue-500/10 border-blue-500/30";
  if (m === "PUT") return "text-amber-400 bg-amber-500/10 border-amber-500/30";
  if (m === "DELETE") return "text-red-400 bg-red-500/10 border-red-500/30";
  if (m === "PATCH") return "text-purple-400 bg-purple-500/10 border-purple-500/30";
  return "text-muted-foreground bg-muted/10 border-muted/30";
}

function ApiPill({ label }: { label: string }) {
  const parts = label.trim().split(" ");
  const method = parts[0] ?? "";
  const path = parts.slice(1).join(" ") || label;
  const hasMethod = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].includes(method.toUpperCase());

  if (!hasMethod) {
    return (
      <span className="font-mono text-xs px-2 py-0.5 rounded-none bg-muted/20 border border-border/40 text-muted-foreground">
        {label}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 font-mono text-xs">
      <Badge
        variant="outline"
        className={cn("rounded-none text-[9px] tracking-wider uppercase border px-1 py-0", getMethodColor(method))}
      >
        {method}
      </Badge>
      <span className="text-foreground/80">{path}</span>
    </span>
  );
}

export function HldTab({ projectId }: HldTabProps) {
  const [flash, setFlash] = useState<string | null>(null);

  const { data: hldData, isLoading, refetch } = useGetHld(
    { projectId },
    {
      retry: false,
      staleTime: 30_000,
    },
  );

  const { mutate: generate, isPending: generating } = useGenerateHld({
    mutation: {
      onSuccess: () => {
        refetch();
        setFlash("HLD generated successfully");
        setTimeout(() => setFlash(null), 4000);
      },
      onError: (err) => {
        setFlash(`Error: ${err.message}`);
        setTimeout(() => setFlash(null), 5000);
      },
    },
  });

  const { mutate: refresh, isPending: refreshing } = useRefreshHld({
    mutation: {
      onSuccess: () => {
        refetch();
        setFlash("HLD regenerated from latest lineage data");
        setTimeout(() => setFlash(null), 4000);
      },
      onError: (err) => {
        setFlash(`Error: ${err.message}`);
        setTimeout(() => setFlash(null), 5000);
      },
    },
  });

  function handleExportJson() {
    if (!hldData) return;
    const blob = new Blob([JSON.stringify(hldData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hld-${projectId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const busy = generating || refreshing;

  const isDeterministic = hldData?.promptVersion === "deterministic-v1";

  return (
    <div className="space-y-6">
      {hldData && isDeterministic && (
        <div className="flex items-center gap-2 px-3 py-2 border border-amber-500/30 bg-amber-500/5 font-mono text-xs text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            HLD generated from lineage data (LLM was unavailable). Click "Regenerate" when the AI service recovers for a richer analysis.
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
          <Layers className="w-4 h-4 text-violet-400" />
          <span>High-Level Design Document</span>
          {hldData && (
            <span className="text-muted-foreground/50">
              · generated {format(new Date(hldData.createdAt), "yyyy-MM-dd HH:mm")}
              <span className={cn("ml-2", isDeterministic ? "text-amber-400/60" : "text-violet-400/60")}>
                · {isDeterministic ? "deterministic" : `prompt ${hldData.promptVersion}`}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {flash && (
            <span
              className={cn(
                "font-mono text-xs px-3 py-1 border",
                flash.startsWith("Error")
                  ? "text-red-400 border-red-500/30 bg-red-500/5"
                  : "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
              )}
            >
              {flash}
            </span>
          )}
          {hldData && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-none font-mono text-xs uppercase border-border/50 hover:border-primary/50 hover:text-primary"
              onClick={handleExportJson}
            >
              <Download className="w-3 h-3 mr-1.5" />
              Export JSON
            </Button>
          )}
          {hldData && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-none font-mono text-xs uppercase border-violet-500/30 text-violet-400 hover:border-violet-500 hover:text-violet-300 bg-violet-500/5"
              disabled={busy}
              onClick={() => refresh({ data: { projectId } })}
            >
              <RefreshCw className={cn("w-3 h-3 mr-1.5", refreshing && "animate-spin")} />
              {refreshing ? "Regenerating..." : "Regenerate"}
            </Button>
          )}
          <Button
            size="sm"
            className="rounded-none font-mono text-xs uppercase bg-violet-600 hover:bg-violet-500 text-white border-0"
            disabled={busy}
            onClick={() => generate({ data: { projectId } })}
          >
            <Sparkles className={cn("w-3 h-3 mr-1.5", generating && "animate-pulse")} />
            {generating ? "Generating..." : hldData ? "Re-Generate HLD" : "Generate HLD"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-16 flex flex-col items-center justify-center text-muted-foreground font-mono text-sm animate-pulse">
          <Layers className="w-8 h-8 mb-4 opacity-30" />
          [LOADING HLD DOCUMENT...]
        </div>
      ) : !hldData ? (
        <div className="p-16 flex flex-col items-center justify-center text-muted-foreground font-mono text-sm border border-dashed border-border/40 bg-muted/5">
          <Layers className="w-10 h-10 mb-4 opacity-20" />
          <p className="mb-2 text-base">NO HLD DOCUMENT YET</p>
          <p className="text-xs opacity-60 mb-6 text-center max-w-sm">
            Run ingest → extract DB schema → analyze → generate lineage, then click "Generate HLD" to create a structured
            High-Level Design from your codebase.
          </p>
          <Button
            size="sm"
            className="rounded-none font-mono text-xs uppercase bg-violet-600 hover:bg-violet-500 text-white border-0"
            disabled={busy}
            onClick={() => generate({ data: { projectId } })}
          >
            <Sparkles className={cn("w-3 h-3 mr-1.5", generating && "animate-pulse")} />
            {generating ? "Generating..." : "Generate HLD"}
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <Card className="border-border/50 bg-card/50 rounded-none border-l-4 border-l-violet-500">
            <CardHeader className="pb-3 border-b border-border/30 bg-violet-500/5">
              <CardTitle className="font-mono text-xs uppercase flex items-center gap-2 text-muted-foreground">
                <Cpu className="w-4 h-4 text-violet-400" />
                System Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 pb-5">
              <p className="text-sm text-foreground/80 leading-relaxed">{hldData.overview}</p>
              {hldData.architecture && (
                <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase text-muted-foreground">Architecture:</span>
                  <Badge variant="outline" className="rounded-none font-mono text-[10px] border-violet-500/40 text-violet-400 bg-violet-500/10">
                    {hldData.architecture}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          <div>
            <div className="font-mono text-xs uppercase text-muted-foreground mb-3 flex items-center gap-2">
              <Layers className="w-3.5 h-3.5" />
              Modules / Services ({hldData.modules.length})
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {hldData.modules.map((mod, idx) => (
                <Card
                  key={mod.name}
                  className={cn(
                    "rounded-none border border-border/40 border-l-4",
                    MODULE_COLORS[idx % MODULE_COLORS.length],
                  )}
                >
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="font-mono text-sm font-semibold text-foreground flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground/60 uppercase mr-1">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      {mod.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    {mod.apis.length > 0 && (
                      <div>
                        <div className="font-mono text-[10px] uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
                          <GitBranch className="w-3 h-3" /> APIs ({mod.apis.length})
                        </div>
                        <div className="space-y-1">
                          {mod.apis.map((api) => (
                            <div key={api} className="pl-2 border-l border-border/30">
                              <ApiPill label={api} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {mod.tables.length > 0 && (
                      <div>
                        <div className="font-mono text-[10px] uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
                          <Database className="w-3 h-3" /> Tables ({mod.tables.length})
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {mod.tables.map((t) => (
                            <Badge
                              key={t}
                              variant="outline"
                              className="rounded-none font-mono text-[10px] border-border/40 text-muted-foreground bg-muted/10"
                            >
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {mod.apis.length === 0 && mod.tables.length === 0 && (
                      <div className="flex items-center gap-1 text-amber-400/70 font-mono text-[10px]">
                        <AlertTriangle className="w-3 h-3" /> No APIs or tables assigned
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {hldData.dataFlow.length > 0 && (
            <Card className="border-border/50 bg-card/50 rounded-none">
              <CardHeader className="pb-3 border-b border-border/30 bg-muted/5">
                <CardTitle className="font-mono text-xs uppercase flex items-center gap-2 text-muted-foreground">
                  <ArrowRight className="w-4 h-4 text-cyan-400" />
                  Data Flow ({hldData.dataFlow.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 pb-5">
                <div className="space-y-2">
                  {hldData.dataFlow.map((flow, i) => (
                    <div key={i} className="flex items-start gap-3 font-mono text-xs text-foreground/80">
                      <span className="text-cyan-400/60 shrink-0 mt-0.5">{String(i + 1).padStart(2, "0")}.</span>
                      <span className="leading-relaxed">{flow}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
