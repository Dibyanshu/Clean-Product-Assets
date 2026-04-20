import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, TerminalSquare, GitBranch, ShieldAlert, Cpu, Zap } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import { 
  useIngestRepository, 
  useAnalyzeProject, 
  useGeneratePrd,
  useGetJob,
  getGetJobQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type PipelineStep = "idle" | "ingesting" | "analyzing" | "generating" | "complete" | "error";

export function Dashboard() {
  const [repoUrl, setRepoUrl] = useState("");
  const [step, setStep] = useState<PipelineStep>("idle");
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [logs, setLogs] = useState<{time: string, msg: string, type: 'info'|'success'|'error'}[]>([]);
  
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const addLog = (msg: string, type: 'info'|'success'|'error' = 'info') => {
    setLogs(prev => [...prev, {
      time: new Date().toLocaleTimeString([], { hour12: false }),
      msg,
      type
    }]);
  };

  const ingestMutation = useIngestRepository();
  const analyzeMutation = useAnalyzeProject();
  const prdMutation = useGeneratePrd();

  const { data: currentJob } = useGetJob(currentJobId || "", {
    query: {
      enabled: !!currentJobId,
      queryKey: getGetJobQueryKey(currentJobId || ""),
      refetchInterval: (data) => {
        if (!data) return 2000;
        // Stop polling if completed or failed
        if (data.status === 'completed' || data.status === 'failed') return false;
        return 2000;
      }
    }
  });

  useEffect(() => {
    if (!currentJob) return;

    if (currentJob.status === 'completed') {
      if (step === 'ingesting') {
        addLog(`[INGEST] Success. Repository processed.`, 'success');
        setStep('analyzing');
        addLog(`[ANALYZE] Initiating structural analysis...`, 'info');
        analyzeMutation.mutate({ data: { projectId: currentJob.projectId! } }, {
          onSuccess: (data) => {
            setCurrentJobId(data.jobId);
          },
          onError: (err) => {
            addLog(`[ANALYZE] Failed to start analysis: ${err.message}`, 'error');
            setStep('error');
          }
        });
      } else if (step === 'analyzing') {
        addLog(`[ANALYZE] Success. API routes extracted.`, 'success');
        setStep('generating');
        addLog(`[PRD] Initiating document generation...`, 'info');
        prdMutation.mutate({ data: { projectId: currentJob.projectId! } }, {
          onSuccess: (data) => {
            setCurrentJobId(data.jobId);
          },
          onError: (err) => {
            addLog(`[PRD] Failed to start PRD generation: ${err.message}`, 'error');
            setStep('error');
          }
        });
      } else if (step === 'generating') {
        addLog(`[PRD] Success. Mission complete.`, 'success');
        setStep('complete');
        toast({
          title: "Pipeline Complete",
          description: "Repository has been fully processed and analyzed.",
        });
      }
    } else if (currentJob.status === 'failed') {
      addLog(`[JOB FAILED] ${currentJob.error || 'Unknown error'}`, 'error');
      setStep('error');
      toast({
        title: "Pipeline Error",
        description: currentJob.error || "An unexpected error occurred during processing.",
        variant: "destructive"
      });
    }
  }, [currentJob?.status, currentJob?.id]); // Only react to status/id changes to avoid infinite loops

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;
    
    setLogs([]);
    setStep('ingesting');
    setProjectId(null);
    setCurrentJobId(null);
    
    addLog(`[SYSTEM] Target designated: ${repoUrl}`, 'info');
    addLog(`[INGEST] Initiating repository clone sequence...`, 'info');
    
    ingestMutation.mutate({ data: { repoUrl } }, {
      onSuccess: (data) => {
        setProjectId(data.projectId);
        setCurrentJobId(data.jobId);
        addLog(`[INGEST] Job ${data.jobId} queued for ${data.projectName}.`, 'info');
      },
      onError: (err) => {
        addLog(`[INGEST] Failure: ${err.message}`, 'error');
        setStep('error');
      }
    });
  };

  const isRunning = step === 'ingesting' || step === 'analyzing' || step === 'generating';

  const viewProject = () => {
    if (projectId) {
      setLocation(`/projects/${projectId}`);
    }
  };

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
          <h2 className="text-3xl font-bold tracking-tight text-foreground uppercase border-l-4 border-primary pl-4 py-1">Mission Control</h2>
          <p className="text-muted-foreground mt-2 font-mono text-sm">INITIATE AGENTIC PIPELINE // DEPLOY ANALYSIS PROBE</p>
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
                <Label htmlFor="repoUrl" className="font-mono text-xs uppercase text-muted-foreground">Target Repository URL</Label>
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

            <div className="mt-8 space-y-4">
              <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2 pb-2 border-b border-border/50">Pipeline Status</div>
              
              <div className="flex items-center gap-3">
                <div className={cn("w-2 h-2 rounded-full", step === 'ingesting' ? "bg-secondary animate-pulse" : (step === 'analyzing' || step === 'generating' || step === 'complete' ? "bg-primary" : "bg-muted"))} />
                <span className={cn("font-mono text-xs uppercase", step === 'ingesting' ? "text-secondary" : "text-muted-foreground")}>1. Ingestion Phase</span>
              </div>
              
              <div className="flex items-center gap-3">
                <div className={cn("w-2 h-2 rounded-full", step === 'analyzing' ? "bg-secondary animate-pulse" : (step === 'generating' || step === 'complete' ? "bg-primary" : "bg-muted"))} />
                <span className={cn("font-mono text-xs uppercase", step === 'analyzing' ? "text-secondary" : "text-muted-foreground")}>2. Structural Analysis</span>
              </div>
              
              <div className="flex items-center gap-3">
                <div className={cn("w-2 h-2 rounded-full", step === 'generating' ? "bg-secondary animate-pulse" : (step === 'complete' ? "bg-primary" : "bg-muted"))} />
                <span className={cn("font-mono text-xs uppercase", step === 'generating' ? "text-secondary" : "text-muted-foreground")}>3. PRD Generation</span>
              </div>
            </div>

            {step === 'complete' && projectId && (
              <div className="mt-8">
                <Button onClick={viewProject} className="w-full rounded-none font-mono uppercase bg-primary text-primary-foreground hover:bg-primary/90" data-testid="button-view-project">
                  View Intelligence Report
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border-border/50 bg-black/40 shadow-inner overflow-hidden flex flex-col h-[500px] lg:h-auto">
          <CardHeader className="bg-muted/10 border-b border-border/30 pb-3 py-3">
            <CardTitle className="font-mono text-xs uppercase flex items-center justify-between text-muted-foreground">
              <div className="flex items-center">
                <Cpu className="w-4 h-4 mr-2" />
                Live Telemetry
              </div>
              {currentJob && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px]">CURRENT JOB: {currentJob.id.substring(0,8)}</span>
                  <StatusBadge status={currentJob.status} />
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
              <div className="space-y-2">
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-muted-foreground shrink-0">[{log.time}]</span>
                    <span className={cn(
                      "break-words",
                      log.type === 'error' ? "text-destructive" :
                      log.type === 'success' ? "text-primary" :
                      "text-foreground/80"
                    )}>
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
