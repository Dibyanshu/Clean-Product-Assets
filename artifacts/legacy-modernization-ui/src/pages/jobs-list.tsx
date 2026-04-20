import { useListJobs } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { formatDistanceToNow, format } from "date-fns";
import { ArrowRight, Terminal } from "lucide-react";

export function JobsList() {
  const { data, isLoading, error } = useListJobs();

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground uppercase border-l-4 border-primary pl-4 py-1">Operations Log</h2>
          <p className="text-muted-foreground mt-2 font-mono text-sm">GLOBAL SYSTEM TELEMETRY // AGENT ACTIVITY</p>
        </div>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur rounded-none">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground font-mono text-sm animate-pulse">
              [FETCHING LOGS...]
            </div>
          ) : error ? (
            <div className="p-8 text-center text-destructive font-mono text-sm">
              [ERROR RETRIEVING LOGS]
            </div>
          ) : !data?.jobs || data.jobs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground font-mono text-sm border border-dashed border-border/50 m-4">
              NO OPERATIONS RECORDED
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/10">
                <TableRow className="border-border/30 hover:bg-transparent">
                  <TableHead className="font-mono text-xs uppercase w-32">Status</TableHead>
                  <TableHead className="font-mono text-xs uppercase w-40">Agent Type</TableHead>
                  <TableHead className="font-mono text-xs uppercase">Message</TableHead>
                  <TableHead className="font-mono text-xs uppercase w-40">Started</TableHead>
                  <TableHead className="w-24 text-right">Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.jobs.sort((a,b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).map((job) => (
                  <TableRow key={job.id} className="border-border/30 hover:bg-muted/10 transition-colors">
                    <TableCell>
                      <StatusBadge status={job.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center font-mono text-xs text-foreground uppercase">
                        <Terminal className="w-3 h-3 mr-2 text-muted-foreground" />
                        {job.agentType}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div className="text-muted-foreground truncate max-w-md" title={job.message}>{job.message}</div>
                      {job.error && <div className="text-destructive mt-1 truncate max-w-md" title={job.error}>ERR: {job.error}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <div title={format(new Date(job.startedAt), 'PPpp')}>
                        {formatDistanceToNow(new Date(job.startedAt), { addSuffix: true })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {job.projectId ? (
                        <Link href={`/projects/${job.projectId}`}>
                          <div className="inline-flex items-center text-[10px] font-mono uppercase text-primary hover:text-primary hover:underline cursor-pointer">
                            Inspect <ArrowRight className="w-3 h-3 ml-1" />
                          </div>
                        </Link>
                      ) : (
                        <span className="text-[10px] font-mono text-muted-foreground uppercase opacity-50">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
