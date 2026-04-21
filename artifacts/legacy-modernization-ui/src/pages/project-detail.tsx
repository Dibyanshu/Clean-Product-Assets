import { useGetProject, useListApis, useListDocuments, useListJobs } from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FolderGit2, FileText, Activity, Server, Clock, GitBranch, TerminalSquare, Search, ChevronLeft } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

function getMethodColor(method: string) {
  switch (method.toUpperCase()) {
    case 'GET': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
    case 'POST': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
    case 'PUT': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    case 'DELETE': return 'text-red-500 bg-red-500/10 border-red-500/20';
    case 'PATCH': return 'text-purple-500 bg-purple-500/10 border-purple-500/20';
    default: return 'text-muted-foreground bg-muted/10 border-muted/20';
  }
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

  const { data: project, isLoading: loadingProject } = useGetProject(id!);
  const { data: apisData, isLoading: loadingApis } = useListApis(id!);
  const { data: docsData, isLoading: loadingDocs } = useListDocuments(id!);
  const { data: jobsData, isLoading: loadingJobs } = useListJobs();

  // Filter jobs for this project
  const projectJobs = jobsData?.jobs.filter(j => j.projectId === id) || [];

  if (loadingProject) {
    return <div className="p-8 text-center font-mono text-muted-foreground animate-pulse">[RETRIEVING TARGET DATA...]</div>;
  }

  if (!project) {
    return <div className="p-8 text-center font-mono text-destructive">[TARGET NOT FOUND]</div>;
  }

  const prdDoc = docsData?.documents.find(d => d.type === 'prd');
  let parsedPrd = null;
  if (prdDoc) {
    try {
      parsedPrd = JSON.parse(prdDoc.content);
    } catch (e) {
      // Content might not be JSON, fallback
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <button
        onClick={() => setLocation("/projects")}
        className="flex items-center gap-1 font-mono text-xs uppercase text-muted-foreground hover:text-primary transition-colors"
        data-testid="button-back"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Project List
      </button>
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-3xl font-bold tracking-tight text-foreground border-l-4 border-primary pl-4 py-1" data-testid="text-project-name">{project.name}</h2>
            <StatusBadge status={project.status} />
          </div>
          <div className="flex items-center text-muted-foreground font-mono text-sm gap-4 ml-5">
            <span className="flex items-center"><GitBranch className="w-3 h-3 mr-1.5" /> {project.repo_url}</span>
            <span className="flex items-center"><FileText className="w-3 h-3 mr-1.5" /> {project.file_count.toLocaleString()} Files</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="apis" className="w-full">
        <TabsList className="bg-muted/10 border border-border/50 p-0 h-auto rounded-none flex w-fit mb-6">
          <TabsTrigger value="apis" className="rounded-none data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-b-primary font-mono text-xs uppercase px-6 py-3" data-testid="tab-apis">
            <Server className="w-3 h-3 mr-2" />
            API Routes ({apisData?.apis.length || 0})
          </TabsTrigger>
          <TabsTrigger value="prd" className="rounded-none data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-b-primary font-mono text-xs uppercase px-6 py-3" data-testid="tab-prd">
            <FileText className="w-3 h-3 mr-2" />
            Generated PRD
          </TabsTrigger>
          <TabsTrigger value="jobs" className="rounded-none data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-b-primary font-mono text-xs uppercase px-6 py-3" data-testid="tab-jobs">
            <Activity className="w-3 h-3 mr-2" />
            Job History ({projectJobs.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="apis" className="mt-0">
          <Card className="border-border/50 bg-card/50 backdrop-blur rounded-none">
            <CardHeader className="border-b border-border/30 bg-muted/5 pb-4">
              <CardTitle className="font-mono text-sm uppercase flex items-center text-muted-foreground">
                <Search className="w-4 h-4 mr-2" /> Extracted Endpoints
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingApis ? (
                <div className="p-8 text-center text-muted-foreground font-mono text-sm animate-pulse">[SCANNING ENDPOINTS...]</div>
              ) : !apisData?.apis || apisData.apis.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground font-mono text-sm">NO API ROUTES DETECTED</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/30 hover:bg-transparent bg-muted/10">
                      <TableHead className="font-mono text-xs uppercase w-24">Method</TableHead>
                      <TableHead className="font-mono text-xs uppercase font-semibold">Path</TableHead>
                      <TableHead className="font-mono text-xs uppercase">Description</TableHead>
                      <TableHead className="font-mono text-xs uppercase text-right">Handler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {apisData.apis.map((api) => (
                      <TableRow key={api.id} className="border-border/30 hover:bg-muted/10 group">
                        <TableCell>
                          <Badge variant="outline" className={cn("rounded-none font-mono text-[10px] tracking-wider uppercase border", getMethodColor(api.method))}>
                            {api.method}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-foreground break-all" data-testid={`text-api-path-${api.id}`}>
                          {api.path}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate" title={api.description || ''}>
                          {api.description || <span className="opacity-50 italic">No description</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground/80 break-all max-w-[200px] truncate" title={api.handler || ''}>
                          {api.handler || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prd" className="mt-0">
          <Card className="border-border/50 bg-card/50 backdrop-blur rounded-none min-h-[500px]">
            {loadingDocs ? (
              <div className="p-12 flex flex-col items-center justify-center text-muted-foreground font-mono text-sm animate-pulse h-[500px]">
                <FileText className="w-8 h-8 mb-4 opacity-50" />
                [GENERATING INTELLIGENCE REPORT...]
              </div>
            ) : !prdDoc ? (
              <div className="p-12 flex flex-col items-center justify-center text-muted-foreground font-mono text-sm h-[500px] border border-dashed border-border/50 m-4">
                <TerminalSquare className="w-8 h-8 mb-4 opacity-50" />
                NO PRD DOCUMENT GENERATED YET
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border/50">
                <div className="col-span-1 p-6 bg-muted/5">
                  <div className="text-xs font-mono uppercase text-muted-foreground tracking-widest mb-6 border-b border-border/50 pb-2">Document Metadata</div>
                  <div className="space-y-4">
                    <div>
                      <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Title</div>
                      <div className="text-sm font-medium">{prdDoc.title}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Generated</div>
                      <div className="text-sm text-muted-foreground">{format(new Date(prdDoc.created_at), 'yyyy-MM-dd HH:mm:ss')}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">ID</div>
                      <div className="text-xs font-mono text-muted-foreground break-all">{prdDoc.id}</div>
                    </div>
                  </div>
                </div>
                <div className="col-span-3 p-6 md:p-8 bg-background/50">
                  <div className="prose prose-invert prose-sm md:prose-base max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-foreground prose-a:text-primary prose-code:text-secondary prose-code:bg-secondary/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-sm">
                    {parsedPrd ? (
                      <div className="space-y-8">
                        <div>
                          <h1 className="text-2xl font-bold uppercase tracking-tight border-b border-border/50 pb-2 mb-4 text-primary">System Overview</h1>
                          <p className="text-foreground/80 leading-relaxed">{parsedPrd.overview || "No overview available."}</p>
                        </div>
                        
                        <div>
                          <h2 className="text-lg font-bold uppercase tracking-tight border-b border-border/50 pb-2 mb-4">Core Features</h2>
                          <ul className="space-y-2">
                            {(parsedPrd.features || []).map((feature: string, i: number) => (
                              <li key={i} className="flex gap-2">
                                <span className="text-primary mt-1">▹</span>
                                <span className="text-foreground/80">{feature}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        
                        <div>
                          <h2 className="text-lg font-bold uppercase tracking-tight border-b border-border/50 pb-2 mb-4">Architecture</h2>
                          <p className="text-foreground/80 leading-relaxed">{parsedPrd.architecture || "No architecture details available."}</p>
                        </div>
                        
                        <div>
                          <h2 className="text-lg font-bold uppercase tracking-tight border-b border-border/50 pb-2 mb-4">Modernization Recommendations</h2>
                          <ul className="space-y-3">
                            {(parsedPrd.modernization_recommendations || []).map((rec: string, i: number) => (
                              <li key={i} className="bg-muted/20 p-3 border-l-2 border-secondary text-foreground/80 text-sm">
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <pre className="p-4 bg-black/50 border border-border/50 rounded-none overflow-x-auto text-xs text-foreground/80 font-mono whitespace-pre-wrap">
                        {prdDoc.content}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="jobs" className="mt-0">
          <Card className="border-border/50 bg-card/50 backdrop-blur rounded-none">
             <CardContent className="p-0">
               {loadingJobs ? (
                <div className="p-8 text-center text-muted-foreground font-mono text-sm animate-pulse">[LOADING TELEMETRY...]</div>
               ) : projectJobs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground font-mono text-sm">NO LOGS FOUND FOR THIS TARGET</div>
               ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/30 hover:bg-transparent bg-muted/10">
                      <TableHead className="font-mono text-xs uppercase w-32">Status</TableHead>
                      <TableHead className="font-mono text-xs uppercase w-32">Agent</TableHead>
                      <TableHead className="font-mono text-xs uppercase">Message</TableHead>
                      <TableHead className="font-mono text-xs uppercase text-right w-40">Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projectJobs.sort((a,b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).map(job => (
                      <TableRow key={job.id} className="border-border/30 hover:bg-muted/10">
                        <TableCell><StatusBadge status={job.status} /></TableCell>
                        <TableCell className="font-mono text-xs uppercase">{job.agentType}</TableCell>
                        <TableCell className="text-sm font-mono text-muted-foreground truncate max-w-md" title={job.message}>{job.message}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {format(new Date(job.startedAt), 'HH:mm:ss')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
               )}
             </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
