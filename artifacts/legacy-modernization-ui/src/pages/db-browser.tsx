import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useListDbTables, useGetDbTableRows } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DatabaseZap, ChevronLeft, ChevronRight, RefreshCcw, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

export function DbBrowser() {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data: tablesData, isLoading: loadingTables, refetch: refetchTables } = useListDbTables({
    query: { refetchOnWindowFocus: false },
  });

  const { data: rowsData, isLoading: loadingRows } = useGetDbTableRows(
    selectedTable ?? "",
    { page, limit: PAGE_SIZE },
    {
      query: {
        enabled: !!selectedTable,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
      },
    },
  );

  const tables = tablesData?.tables ?? [];
  const totalPages = rowsData ? Math.ceil(rowsData.total / rowsData.limit) : 1;

  function handleSelectTable(name: string) {
    setSelectedTable(name);
    setPage(1);
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <DatabaseZap className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-bold tracking-tight text-foreground border-l-4 border-primary pl-4 py-1">
          Database Browser
        </h2>
      </div>
      <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest ml-1">
        Live SQLite in-memory store — all system tables
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-1">
          <Card className="border-border/50 bg-card/50 rounded-none">
            <CardHeader className="border-b border-border/30 bg-muted/5 pb-3 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="font-mono text-xs uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                <Layers className="w-3.5 h-3.5" /> Tables ({tables.length})
              </CardTitle>
              <button
                onClick={() => refetchTables()}
                title="Refresh table list"
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                <RefreshCcw className="w-3.5 h-3.5" />
              </button>
            </CardHeader>
            <CardContent className="p-0">
              {loadingTables ? (
                <div className="p-4 text-center font-mono text-xs text-muted-foreground animate-pulse">
                  [SCANNING...]
                </div>
              ) : tables.length === 0 ? (
                <div className="p-4 text-center font-mono text-xs text-muted-foreground">
                  NO TABLES FOUND
                </div>
              ) : (
                <ul className="divide-y divide-border/30">
                  {tables.map((t) => (
                    <li key={t.name}>
                      <button
                        onClick={() => handleSelectTable(t.name)}
                        className={cn(
                          "w-full text-left px-4 py-3 flex items-center justify-between group transition-colors",
                          selectedTable === t.name
                            ? "bg-primary/10 text-primary border-l-2 border-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30 border-l-2 border-transparent",
                        )}
                      >
                        <span className="font-mono text-xs truncate">{t.name}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-none font-mono text-[10px] shrink-0 ml-2",
                            selectedTable === t.name
                              ? "border-primary/30 text-primary"
                              : "border-border/50 text-muted-foreground",
                          )}
                        >
                          {t.rowCount.toLocaleString()}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-3">
          {!selectedTable ? (
            <Card className="border-border/50 bg-card/50 rounded-none min-h-[400px] flex items-center justify-center">
              <div className="text-center text-muted-foreground font-mono text-sm p-12">
                <DatabaseZap className="w-10 h-10 mx-auto mb-4 opacity-30" />
                SELECT A TABLE TO BROWSE ITS ROWS
              </div>
            </Card>
          ) : (
            <Card className="border-border/50 bg-card/50 rounded-none">
              <CardHeader className="border-b border-border/30 bg-muted/5 pb-3 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-3">
                  <CardTitle className="font-mono text-xs uppercase text-muted-foreground tracking-widest">
                    {selectedTable}
                  </CardTitle>
                  {rowsData && (
                    <Badge variant="outline" className="rounded-none font-mono text-[10px] border-border/50 text-muted-foreground">
                      {rowsData.total.toLocaleString()} rows
                    </Badge>
                  )}
                  {rowsData && rowsData.columns.length > 0 && (
                    <Badge variant="outline" className="rounded-none font-mono text-[10px] border-border/50 text-muted-foreground">
                      {rowsData.columns.length} cols
                    </Badge>
                  )}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="hover:text-primary disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span>
                      {page} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="hover:text-primary disabled:opacity-30 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                {loadingRows ? (
                  <div className="p-8 text-center font-mono text-xs text-muted-foreground animate-pulse">
                    [QUERYING {selectedTable.toUpperCase()}...]
                  </div>
                ) : !rowsData || rowsData.rows.length === 0 ? (
                  <div className="p-8 text-center font-mono text-xs text-muted-foreground">
                    TABLE IS EMPTY
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/30 hover:bg-transparent bg-muted/10">
                        {rowsData.columns.map((col) => (
                          <TableHead
                            key={col}
                            className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground whitespace-nowrap"
                          >
                            {col}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rowsData.rows.map((row, ri) => (
                        <TableRow
                          key={ri}
                          className="border-border/30 hover:bg-muted/10 group"
                        >
                          {rowsData.columns.map((col) => {
                            const val = row[col];
                            const isNull = val === null || val === undefined;
                            const isLong =
                              typeof val === "string" && val.length > 120;
                            return (
                              <TableCell
                                key={col}
                                className={cn(
                                  "font-mono text-xs max-w-[280px]",
                                  isNull
                                    ? "text-muted-foreground/40 italic"
                                    : "text-foreground/80",
                                )}
                                title={isLong ? String(val) : undefined}
                              >
                                {isNull ? (
                                  "NULL"
                                ) : isLong ? (
                                  <span className="truncate block">{String(val).slice(0, 120)}…</span>
                                ) : (
                                  String(val)
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
