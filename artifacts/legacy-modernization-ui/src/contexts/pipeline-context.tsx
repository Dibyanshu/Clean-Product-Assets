import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
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

export type PipelineStep =
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

export type LogEntry = {
  time: string;
  msg: string;
  type: "info" | "success" | "error" | "warn";
};

export const STAGE_DEFS: { key: PipelineStep; label: string; tag: string }[] = [
  { key: "ingesting",            label: "Ingestion",              tag: "INGEST" },
  { key: "analyzing",            label: "API Route Extraction",   tag: "ANALYZE" },
  { key: "extracting-schema",    label: "DB Schema Extraction",   tag: "SCHEMA" },
  { key: "generating-prd",       label: "PRD Generation",         tag: "PRD" },
  { key: "generating-lineage",   label: "Lineage Mapping",        tag: "LINEAGE" },
  { key: "enhancing-lineage-ai", label: "AI Lineage Enhancement", tag: "LINEAGE-AI" },
  { key: "generating-hld",       label: "HLD Generation",         tag: "HLD" },
];

export const STEP_ORDER: PipelineStep[] = [
  "ingesting",
  "analyzing",
  "extracting-schema",
  "generating-prd",
  "generating-lineage",
  "enhancing-lineage-ai",
  "generating-hld",
  "complete",
];

export function stageState(
  stageKey: PipelineStep,
  currentStep: PipelineStep,
): "done" | "active" | "pending" {
  if (currentStep === "error") {
    return "pending";
  }
  const ci = STEP_ORDER.indexOf(currentStep);
  const si = STEP_ORDER.indexOf(stageKey);
  if (si < ci) return "done";
  if (si === ci) return "active";
  return "pending";
}

type PipelineContextValue = {
  step: PipelineStep;
  logs: LogEntry[];
  projectId: string | null;
  currentJobId: string | null;
  repoUrl: string;
  setRepoUrl: (v: string) => void;
  isRunning: boolean;
  startPipeline: (url: string) => void;
  clearLogs: () => void;
  currentJobStatus: string | undefined;
  currentJobShortId: string | undefined;
};

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function usePipeline() {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline must be used inside PipelineProvider");
  return ctx;
}

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<PipelineStep>("idle");
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [repoUrl, setRepoUrl] = useState("");

  const stepRef = useRef<PipelineStep>("idle");
  const projectIdRef = useRef<string | null>(null);

  const { toast } = useToast();

  const addLog = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    setLogs((prev) => [
      ...prev,
      { time: new Date().toLocaleTimeString([], { hour12: false }), msg, type },
    ]);
  }, []);

  const advanceTo = useCallback((next: PipelineStep) => {
    stepRef.current = next;
    setStep(next);
  }, []);

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

  const runSyncStages = useCallback((pid: string) => {
    advanceTo("generating-lineage");
    addLog(`[LINEAGE] Building API ↔ DB lineage map...`, "info");
    setCurrentJobId(null);

    lineageMutation.mutate({ data: { projectId: pid } }, {
      onSuccess: (d) => {
        const n = d.entries?.length ?? 0;
        addLog(`[LINEAGE] ${n} lineage entries mapped.`, "success");
        advanceTo("enhancing-lineage-ai");
        addLog(`[LINEAGE-AI] Running RAG + LLM enhancement on all entries...`, "info");

        lineageAiMutation.mutate({ data: { projectId: pid } }, {
          onSuccess: (r) => {
            addLog(`[LINEAGE-AI] ${r.enhanced ?? 0} entries enhanced (${r.fallback ?? 0} fallback).`, "success");
            advanceTo("generating-hld");
            addLog(`[HLD] Generating High-Level Design via LLM...`, "info");

            hldMutation.mutate({ data: { projectId: pid } }, {
              onSuccess: () => {
                addLog(`[HLD] High-Level Design generated.`, "success");
                addLog(`[SYSTEM] ✓ Full pipeline complete.`, "success");
                advanceTo("complete");
                toast({ title: "Pipeline Complete", description: "All 7 agents finished successfully." });
              },
              onError: (e) => {
                addLog(`[HLD] Warning: ${e.message}`, "warn");
                addLog(`[SYSTEM] Pipeline complete (HLD generation skipped).`, "warn");
                advanceTo("complete");
                toast({ title: "Pipeline Complete", description: "Completed — HLD generation had a warning." });
              },
            });
          },
          onError: (e) => {
            addLog(`[LINEAGE-AI] Warning: ${e.message}`, "warn");
            addLog(`[HLD] Generating High-Level Design via LLM (skipping AI lineage)...`, "info");
            advanceTo("generating-hld");

            hldMutation.mutate({ data: { projectId: pid } }, {
              onSuccess: () => {
                addLog(`[HLD] High-Level Design generated.`, "success");
                addLog(`[SYSTEM] ✓ Pipeline complete (AI lineage skipped).`, "warn");
                advanceTo("complete");
                toast({ title: "Pipeline Complete", description: "Completed — AI lineage skipped." });
              },
              onError: (e2) => {
                addLog(`[HLD] Warning: ${e2.message}`, "warn");
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
        toast({ title: "Pipeline Error", description: e.message, variant: "destructive" });
      },
    });
  }, [lineageMutation, lineageAiMutation, hldMutation, addLog, advanceTo, toast]);

  useEffect(() => {
    if (!currentJob) return;
    const pid = currentJob.projectId ?? projectIdRef.current ?? projectId;

    if (currentJob.status === "completed") {
      const s = stepRef.current;

      if (s === "ingesting") {
        addLog(`[INGEST] Repository cloned and indexed.`, "success");
        advanceTo("analyzing");
        addLog(`[ANALYZE] Extracting API routes via AST...`, "info");
        analyzeMutation.mutate({ data: { projectId: pid! } }, {
          onSuccess: (d) => setCurrentJobId(d.jobId),
          onError:   (e) => { addLog(`[ANALYZE] Failed: ${e.message}`, "error"); advanceTo("error"); },
        });

      } else if (s === "analyzing") {
        addLog(`[ANALYZE] API routes extracted.`, "success");
        advanceTo("extracting-schema");
        addLog(`[SCHEMA] Running DB schema extractor...`, "info");
        schemaMutation.mutate({ data: { projectId: pid! } }, {
          onSuccess: (d) => setCurrentJobId(d.jobId),
          onError:   (e) => { addLog(`[SCHEMA] Failed: ${e.message}`, "error"); advanceTo("error"); },
        });

      } else if (s === "extracting-schema") {
        addLog(`[SCHEMA] DB schema extracted.`, "success");
        advanceTo("generating-prd");
        addLog(`[PRD] Generating intelligence report via LLM...`, "info");
        prdMutation.mutate({ data: { projectId: pid! } }, {
          onSuccess: (d) => setCurrentJobId(d.jobId),
          onError:   (e) => { addLog(`[PRD] Failed: ${e.message}`, "error"); advanceTo("error"); },
        });

      } else if (s === "generating-prd") {
        addLog(`[PRD] Document generated.`, "success");
        runSyncStages(pid!);
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

  const startPipeline = useCallback((url: string) => {
    setLogs([]);
    setProjectId(null);
    projectIdRef.current = null;
    setCurrentJobId(null);
    advanceTo("ingesting");

    addLog(`[SYSTEM] Target: ${url}`, "info");
    addLog(`[INGEST] Cloning repository...`, "info");

    ingestMutation.mutate({ data: { repoUrl: url } }, {
      onSuccess: (d) => {
        setProjectId(d.projectId);
        projectIdRef.current = d.projectId;
        setCurrentJobId(d.jobId);
        addLog(
          `[INGEST] Job ${d.jobId.substring(0, 8)}… queued for "${d.projectName}" (${d.fileCount} files).`,
          "info",
        );
      },
      onError: (e) => {
        addLog(`[INGEST] Failed: ${e.message}`, "error");
        advanceTo("error");
      },
    });
  }, [ingestMutation, addLog, advanceTo]);

  const clearLogs = useCallback(() => setLogs([]), []);

  const isRunning = step !== "idle" && step !== "complete" && step !== "error";

  return (
    <PipelineContext.Provider
      value={{
        step,
        logs,
        projectId,
        currentJobId,
        repoUrl,
        setRepoUrl,
        isRunning,
        startPipeline,
        clearLogs,
        currentJobStatus: currentJob?.status,
        currentJobShortId: currentJob?.id?.substring(0, 8),
      }}
    >
      {children}
    </PipelineContext.Provider>
  );
}
