import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, TerminalSquare, Cpu, Zap, CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import {
  useIngestRepository,
  useAnalyzeProject,
  useExtractDbSchema,
  useGeneratePrd,
  useGenerateLineage,
  useEnhanceLineageAIBulk,
  useGenerateHld,
  useGetJob,
  getGetJobQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type PipelineStep =
  | "idle"
  | "ingesting"
  | "analyzing"
  | "extracting-schema"
  | "generating-prd"
  | "generating-lineage"
  | "enhancing-lineage-ai"
  | "generating-hld"
  | "complete"
  | "error";

const STAGE_DEFS: { key: PipelineStep; label: string; tag: string }[] = [
  { key: "ingesting",            label: "Ingestion",              tag: "INGEST" },
  { key: "analyzing",            label: "API Route Extraction",   tag: "ANALYZE" },
  { key: "extracting-schema",    label: "DB Schema Extraction",   tag: "SCHEMA" },
  { key: "generating-prd",       label: "PRD Generation",         tag: "PRD" },
  { key: "generating-lineage",   label: "Lineage Mapping",        tag: "LINEAGE" },
  { key: "enhancing-lineage-ai", label: "AI Lineage Enhancement", tag: "LINEAGE-AI" },
  { key: "generating-hld",       label: "HLD Generation",         tag: "HLD" },
];

const STEP_ORDER: PipelineStep[] = STAGE_DEFS.map((s) => s.key).concat("complete" as PipelineStep);

function stageState(stageKey: PipelineStep, currentStep: PipelineStep): "done" | "active" | "pending" {
  if (currentStep === "error") {
    const ci = STEP_ORDER.indexOf(stageKey);
    const ai = STEP_ORDER.indexOf(currentStep);
    return ci < ai ? "done" : "pending";
  }
  const ci = STEP_ORDER.indexOf(currentStep as PipelineStep);
  const si = STEP_ORDER.indexOf(stageKey);
  if (si < ci) return "done";
  if (si === ci) return "active";
  return "pending";
}

export function Dashboard() {
  const [repoUrl, setRepoUrl] = useState("");
  const [step, setStep] = useState<PipelineStep>("idle");
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ time: string; msg: string; type: "info" | "success" | "error" | "warn" }[]>([]);

  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const stepRef = useRef<PipelineStep>("idle");

  const addLog = (msg: string, type: "info" | "success" | "error" | "warn" = "info") => {
    setLogs((prev) => [
      ...prev,
      { time: new Date().toLocaleTimeString([], { hour12: false }), msg, type },
    ]);
  };

  const advanceTo = (next: PipelineStep) => {
    stepRef.current = next;
    setStep(next);
  };

  const ingestMutation    = useIngestRepository();
  const analyzeMutation   = useAnalyzeProject();
  const schemaMutation    = useExtractDbSchema();
  const prdMutation       = useGeneratePrd();
  const lineageMutation   = useGenerateLineage();
  const lineageAiMutation = useEnhanceLineageAIBulk();
  const hldMutation       = useGenerateHld();

  const { data: currentJob } = useGetJob(currentJobId ?? "", {
    query: {
      enabled: !!currentJobId,
      queryKey: getGetJobQueryKey(currentJobId ?? ""),
      refetchInterval: (data) => {
        if (!data) return 2000;
        return data.status === "completed" || data.status === "failed" ? false : 2000;
      },
    },
  });

  useEffect(() => {
    if (!currentJob) return;

    const pid = currentJob.projectId ?? projectId;

    if (currentJob.status === "completed") {
      const s = stepRef.current;

      if (s === "ingesting") {
        addLog(`[INGEST] Repository cloned and indexed.`, "success");
        advanceTo("analyzing");
        addLog(`[ANALYZE] Extracting API routes via AST...`, "info");
        analyzeMutation.mutate({ data: { projectId: pid! } }, {
          onSuccess: (d) => { setCurrentJobId(d.jobId); },
          onError:   (e) => { addLog(`[ANALYZE] Failed: ${e.message}`, "error"); advanceTo("error"); },
        });

      } else if (s === "analyzing") {
        addLog(`[ANALYZE] API routes extracted.`, "success");
        advanceTo("extracting-schema");
        addLog(`[SCHEMA] Running DB schema extractor...`, "info");
        schemaMutation.mutate({ data: { projectId: pid! } }, {
          onSuccess: (d) => { setCurrentJobId(d.jobId); },
          onError:   (e) => { addLog(`[SCHEMA] Failed: ${e.message}`, "error"); advanceTo("error"); },
        });

      } else if (s === "extracting-schema") {
        addLog(`[SCHEMA] DB schema extracted.`, "success");
        advanceTo("generating-prd");
        addLog(`[PRD] Generating intelligence report via LLM...`, "info");
        prdMutation.mutate({ data: { projectId: pid! } }, {
          onSuccess: (d) => { setCurrentJobId(d.jobId); },
          onError:   (e) => { addLog(`[PRD] Failed: ${e.message}`, "error"); advanceTo("error"); },
        });

      } else if (s === "generating-prd") {
        addLog(`[PRD] Document generated.`, "success");
        advanceTo("generating-lineage");
        addLog(`[LINEAGE] Building API ↔ DB lineage map...`, "info");
        setCurrentJobId(null);
        lineageMutation.mutate({ data: { projectId: pid! } }, {
          onSuccess: (d) => {
            const n = d.entries?.length ?? 0;
            addLog(`[LINEAGE] ${n} lineage entries mapped.`, "success");
            advanceTo("enhancing-lineage-ai");
            addLog(`[LINEAGE-AI] Running RAG + LLM enhancement on all entries...`, "info");
            lineageAiMutation.mutate({ data: { projectId: pid! } }, {
              onSuccess: (r) => {
                addLog(`[LINEAGE-AI] ${r.enhanced ?? 0} entries enhanced (${r.fallback ?? 0} fallback).`, "success");
                advanceTo("generating-hld");
                addLog(`[HLD] Generating High-Level Design document via LLM...`, "info");
                hldMutation.mutate({ data: { projectId: pid! } }, {
                  onSuccess: () => {
                    addLog(`[HLD] High-Level Design generated.`, "success");
                    addLog(`[SYSTEM] ✓ Full pipeline complete.`, "success");
                    advanceTo("complete");
                    toast({ title: "Pipeline Complete", description: "All 7 agents finished successfully." });
                  },
                  onError: (e) => {
                    addLog(`[HLD] Failed: ${e.message}`, "warn");
                    addLog(`[SYSTEM] Pipeline completed with HLD warning.`, "warn");
                    advanceTo("complete");
                    toast({ title: "Pipeline Complete", description: "Completed with HLD generation warning." });
                  },
                });
              },
              onError: (e) => {
                addLog(`[LINEAGE-AI] Failed: ${e.message}`, "warn");
                advanceTo("generating-hld");
                addLog(`[HLD] Generating High-Level Design document via LLM...`, "info");
                hldMutation.mutate({ data: { projectId: pid! } }, {
                  onSuccess: () => {
                    addLog(`[HLD] High-Level Design generated.`, "success");
                    addLog(`[SYSTEM] ✓ Pipeline complete (AI lineage skipped).`, "success");
                    advanceTo("complete");
                    toast({ title: "Pipeline Complete", description: "Completed with AI lineage skipped." });
                  },
                  onError: (e2) => {
                    addLog(`[HLD] Failed: ${e2.message}`, "warn");
                    advanceTo("complete");
                    toast({ title: "Pipeline Complete", description: "Completed with some warnings." });
                  },
                });
              },
            });
          },
          onError: (e) => {
            addLog(`[LINEAGE] Failed: ${e.message}`, "error");
            advanceTo("error");
          },
        });
      }

    } else if (currentJob.status === "failed") {
      addLog(`[JOB FAILED] ${currentJob.error ?? "Unknown error"}`, "error");
      advanceTo("error");
      toast({
        title: "Pipeline Error",
        description: currentJob.error ?? "Unexpected error during processing.",
        variant: "destructive",
      });
    }
  }, [currentJob?.status, currentJob?.id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    setLogs([]);
    advanceTo("ingesting");
    setProjectId(null);
    setCurrentJobId(null);

    addLog(`[SYSTEM] Target: ${repoUrl}`, "info");
    addLog(`[INGEST] Cloning repository...`, "info");

    ingestMutation.mutate({ data: { repoUrl } }, {
      onSuccess: (d) => {
        setProjectId(d.projectId);
        setCurrentJobId(d.jobId);
        addLog(`[INGEST] Job ${d.jobId.substring(0, 8)}… queued for "${d.projectName}" (${d.fileCount} files).`, "info");
      },
      onError: (e) => {
        addLog(`[INGEST] Failed: ${e.message}`, "error");
        advanceTo("error");
      },
    });
  };

  const isRunning = step !== "idle" && step !== "complete" && step !== "error";
  const effectiveProjectId = projectId;

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground uppercase border-l-4 border-primary pl-4 py-1">
            Mission Control
          </h2>
          <p className="text-muted-foreground mt-2 font-mono text-sm">
            FULL AGENTIC PIPELINE // 7-STAGE ANALYSIS SEQUENCE
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 border-primary/20 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="font-mono text-sm uppercase flex items-center text-primary">
              <TerminalSquare className="w-4 h-4 mr-2" />
              Launch Parameters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="repoUrl" className="font-mono text-xs uppercase text-muted-foreground">
                  Target Repository URL
                </Label>
                <Input
                  id="repoUrl"
                  placeholder="https://github.com/org/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  disabled={isRunning}
                  data-testid="input-repourl"
                  className="font-mono bg-background border-border/50 focus-visible:ring-primary focus-visible:border-primary rounded-none"
                />
              </div>
              <Button
                type="submit"
                disabled={!repoUrl || isRunning}
                className="w-full font-mono uppercase tracking-widest rounded-none border border-primary/50 hover:bg-primary/20 bg-primary/10 text-primary transition-all"
                data-testid="button-launch"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Executing...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Launch Sequence
                  </>
                )}
              </Button>
            </form>

            <div className="mt-8 space-y-3">
              <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3 pb-2 border-b border-border/50">
                Pipeline Status
              </div>
              {STAGE_DEFS.map(({ key, label }, idx) => {
                const state = stageState(key, step);
                return (
                  <div key={key} className="flex items-center gap-3">
                    {state === "done" ? (
                      <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                    ) : (
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full shrink-0 ml-0.5",
                          state === "active" ? "bg-secondary animate-pulse" : "bg-muted",
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "font-mono text-xs uppercase",
                        state === "active"
                          ? "text-secondary"
                          : state === "done"
                          ? "text-primary"
                          : "text-muted-foreground",
                      )}
                    >
                      {idx + 1}. {label}
                    </span>
                  </div>
                );
              })}
            </div>

            {(step === "complete" || step === "error") && effectiveProjectId && (
              <div className="mt-6">
                <Button
                  onClick={() => setLocation(`/projects/${effectiveProjectId}`)}
                  className="w-full rounded-none font-mono uppercase bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-view-project"
                >
                  View Intelligence Report
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border-border/50 bg-black/40 shadow-inner overflow-hidden flex flex-col h-[540px] lg:h-auto">
          <CardHeader className="bg-muted/10 border-b border-border/30 pb-3 py-3">
            <CardTitle className="font-mono text-xs uppercase flex items-center justify-between text-muted-foreground">
              <div className="flex items-center">
                <Cpu className="w-4 h-4 mr-2" />
                Live Telemetry
              </div>
              {currentJob && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px]">JOB: {currentJob.id.substring(0, 8)}</span>
                  <StatusBadge status={currentJob.status} />
                </div>
              )}
              {isRunning && !currentJob && (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-secondary" />
                  <span className="text-[10px] text-secondary">PROCESSING</span>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-4 font-mono text-xs" ref={scrollRef}>
            {logs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground/50 italic">
                Awaiting input coordinates...
              </div>
            ) : (
              <div className="space-y-1.5">
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-muted-foreground shrink-0">[{log.time}]</span>
                    <span
                      className={cn(
                        "break-words",
                        log.type === "error"
                          ? "text-destructive"
                          : log.type === "success"
                          ? "text-primary"
                          : log.type === "warn"
                          ? "text-amber-400"
                          : "text-foreground/80",
                      )}
                    >
                      {log.msg}
                    </span>
                  </div>
                ))}
                {isRunning && (
                  <div className="flex gap-3 text-secondary animate-pulse">
                    <span className="shrink-0">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
                    <span>_</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
