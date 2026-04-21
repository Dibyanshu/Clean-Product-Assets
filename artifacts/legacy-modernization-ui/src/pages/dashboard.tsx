import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, TerminalSquare, Cpu, Zap, CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import {
  usePipeline,
  STAGE_DEFS,
  stageState,
} from "@/contexts/pipeline-context";

export function Dashboard() {
  const {
    step,
    logs,
    projectId,
    repoUrl,
    setRepoUrl,
    isRunning,
    startPipeline,
    currentJobStatus,
    currentJobShortId,
  } = usePipeline();

  const [, setLocation] = useLocation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl || isRunning) return;
    startPipeline(repoUrl);
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

            {(step === "complete" || step === "error") && projectId && (
              <div className="mt-6">
                <Button
                  onClick={() => setLocation(`/projects/${projectId}`)}
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
              {currentJobShortId && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px]">JOB: {currentJobShortId}</span>
                  {currentJobStatus && <StatusBadge status={currentJobStatus} />}
                </div>
              )}
              {isRunning && !currentJobShortId && (
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
