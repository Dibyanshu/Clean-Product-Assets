import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FolderGit2, FileText, ArrowRight, Activity, Calendar } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { StatusBadge } from "@/components/status-badge";

export function ProjectsList() {
  const { data, isLoading, error } = useListProjects();

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground uppercase border-l-4 border-primary pl-4 py-1">Project Registry</h2>
          <p className="text-muted-foreground mt-2 font-mono text-sm">INDEXED REPOSITORIES // ANALYSIS ARCHIVE</p>
        </div>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur rounded-none">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground font-mono text-sm animate-pulse">
              [SCANNING DATABASE...]
            </div>
          ) : error ? (
            <div className="p-8 text-center text-destructive font-mono text-sm">
              [ERROR RETRIEVING DATA]
            </div>
          ) : !data?.projects || data.projects.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground font-mono text-sm border border-dashed border-border/50 m-4">
              NO PROJECTS FOUND IN REGISTRY
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/10">
                <TableRow className="border-border/30 hover:bg-transparent">
                  <TableHead className="font-mono text-xs uppercase">Repository</TableHead>
                  <TableHead className="font-mono text-xs uppercase w-32">Status</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-right w-24">Files</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-right w-40">Last Scan</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.projects.map((project) => (
                  <TableRow key={project.id} className="border-border/30 hover:bg-muted/10 transition-colors group">
                    <TableCell>
                      <div className="flex items-center">
                        <FolderGit2 className="w-4 h-4 mr-3 text-muted-foreground" />
                        <div>
                          <div className="font-medium text-sm" data-testid={`text-project-name-${project.id}`}>{project.name}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-1 opacity-70">{project.repo_url}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={project.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      <div className="flex items-center justify-end text-muted-foreground">
                        <FileText className="w-3 h-3 mr-1.5" />
                        {project.file_count.toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      <div className="flex items-center justify-end">
                        <Calendar className="w-3 h-3 mr-1.5 opacity-50" />
                        {formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/projects/${project.id}`}>
                        <Button variant="ghost" size="sm" className="font-mono text-xs uppercase opacity-0 group-hover:opacity-100 transition-opacity text-primary hover:text-primary hover:bg-primary/10 rounded-none border border-transparent hover:border-primary/20" data-testid={`link-project-${project.id}`}>
                          Inspect <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
                      </Link>
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
