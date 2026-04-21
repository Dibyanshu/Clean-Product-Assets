import { useState } from "react";
import { useExtractDbSchema, useGetDbSchema } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Database, Loader2, RefreshCw, FunctionSquare, KeyRound, Minus } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
}

function TypeBadge({ type }: { type: string }) {
  const color =
    type === "INTEGER" || type === "REAL"
      ? "text-amber-400 bg-amber-400/10 border-amber-400/20"
      : type === "TEXT"
        ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
        : type === "DATETIME" || type === "BLOB"
          ? "text-blue-400 bg-blue-400/10 border-blue-400/20"
          : "text-muted-foreground bg-muted/10 border-muted/20";
  return (
    <Badge variant="outline" className={cn("rounded-none font-mono text-[10px] uppercase border tracking-wider", color)}>
      {type}
    </Badge>
  );
}

export function DbSchemaTab({ projectId }: Props) {
  const queryClient = useQueryClient();
  const [isExtracting, setIsExtracting] = useState(false);

  const { data: schema, isLoading } = useGetDbSchema(projectId);
  const extractMutation = useExtractDbSchema();

  const handleExtract = () => {
    setIsExtracting(true);
    extractMutation.mutate(
      { data: { projectId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["getDbSchema", projectId] });
          setIsExtracting(false);
        },
        onError: () => setIsExtracting(false),
      },
    );
  };

  const tables = schema?.tables ?? [];
  const functions = schema?.functions ?? [];
  const extractedAt = schema?.extractedAt ?? null;
  const hasData = tables.length > 0 || functions.length > 0;
  const busy = isExtracting || extractMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs uppercase text-muted-foreground">
            {hasData
              ? `${tables.length} table${tables.length !== 1 ? "s" : ""} · ${functions.length} function${functions.length !== 1 ? "s" : ""}`
              : "No schema extracted yet"}
          </span>
          {extractedAt && (
            <span className="font-mono text-[10px] text-muted-foreground/60 border border-border/30 px-2 py-0.5">
              LAST RUN: {format(new Date(extractedAt), "yyyy-MM-dd HH:mm:ss")}
            </span>
          )}
        </div>
        <Button
          onClick={handleExtract}
          disabled={busy}
          size="sm"
          className="rounded-none font-mono uppercase text-xs tracking-widest border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
          data-testid="button-extract-schema"
        >
          {busy ? (
            <>
              <Loader2 className="w-3 h-3 mr-2 animate-spin" />
              Extracting...
            </>
          ) : hasData ? (
            <>
              <RefreshCw className="w-3 h-3 mr-2" />
              Re-Extract Schema
            </>
          ) : (
            <>
              <Database className="w-3 h-3 mr-2" />
              Extract Schema
            </>
          )}
        </Button>
      </div>

      {isLoading ? (
        <div className="p-12 flex flex-col items-center justify-center text-muted-foreground font-mono text-sm animate-pulse border border-border/30">
          <Database className="w-8 h-8 mb-3 opacity-40" />
          [READING SCHEMA...]
        </div>
      ) : !hasData ? (
        <div className="p-12 flex flex-col items-center justify-center text-muted-foreground font-mono text-sm border border-dashed border-border/50">
          <Database className="w-8 h-8 mb-3 opacity-40" />
          <p>NO SCHEMA EXTRACTED YET</p>
          <p className="text-xs mt-1 opacity-60">Click "Extract Schema" to analyse the database structure</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Tables Section */}
          <Card className="border-border/50 bg-card/50 rounded-none">
            <CardHeader className="border-b border-border/30 bg-muted/5 pb-4">
              <CardTitle className="font-mono text-sm uppercase flex items-center gap-2 text-muted-foreground">
                <Database className="w-4 h-4" />
                Tables ({tables.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Accordion type="multiple" className="w-full">
                {tables.map((table) => (
                  <AccordionItem
                    key={table.id}
                    value={table.id}
                    className="border-b border-border/30 last:border-0"
                  >
                    <AccordionTrigger className="px-6 py-3 hover:bg-muted/10 hover:no-underline font-mono text-sm [&>svg]:text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span className="text-primary font-semibold uppercase tracking-wide">
                          {table.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground border border-border/40 px-1.5 py-0.5">
                          {table.columns.length} col{table.columns.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-0">
                      <div className="border-t border-border/20">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/10 border-b border-border/20">
                              <th className="text-left px-6 py-2 font-mono text-[10px] uppercase text-muted-foreground w-8"></th>
                              <th className="text-left px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground">Column</th>
                              <th className="text-left px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground">Type</th>
                              <th className="text-left px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground">Nullable</th>
                            </tr>
                          </thead>
                          <tbody>
                            {table.columns.map((col) => (
                              <tr
                                key={col.id}
                                className="border-b border-border/10 last:border-0 hover:bg-muted/5"
                              >
                                <td className="px-6 py-2.5 text-center">
                                  {col.is_primary ? (
                                    <KeyRound className="w-3 h-3 text-amber-400 mx-auto" aria-label="Primary Key" />
                                  ) : (
                                    <Minus className="w-3 h-3 text-muted-foreground/30 mx-auto" />
                                  )}
                                </td>
                                <td className="px-3 py-2.5 font-mono text-xs text-foreground">
                                  {col.name}
                                </td>
                                <td className="px-3 py-2.5">
                                  <TypeBadge type={col.type} />
                                </td>
                                <td className="px-3 py-2.5 font-mono text-[10px]">
                                  {col.is_nullable ? (
                                    <span className="text-muted-foreground/60">YES</span>
                                  ) : (
                                    <span className="text-destructive/80 font-semibold">NO</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>

          {/* Functions Section */}
          <Card className="border-border/50 bg-card/50 rounded-none">
            <CardHeader className="border-b border-border/30 bg-muted/5 pb-4">
              <CardTitle className="font-mono text-sm uppercase flex items-center gap-2 text-muted-foreground">
                <FunctionSquare className="w-4 h-4" />
                Functions / Procedures ({functions.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {functions.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground font-mono text-xs">
                  NO STORED FUNCTIONS DETECTED
                </div>
              ) : (
                <div className="divide-y divide-border/20">
                  {functions.map((fn) => (
                    <div key={fn.id} className="px-6 py-4 hover:bg-muted/5 group">
                      <div className="flex items-start gap-4">
                        <FunctionSquare className="w-4 h-4 text-primary/60 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-mono text-sm text-primary font-semibold">
                              {fn.name}
                            </span>
                            {fn.parameters && (
                              <code className="font-mono text-xs bg-muted/30 border border-border/40 px-2 py-0.5 text-muted-foreground">
                                ({fn.parameters})
                              </code>
                            )}
                          </div>
                          {fn.description && (
                            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                              {fn.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
