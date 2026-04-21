import { useState, useRef } from "react";
import { useSemanticSearch } from "@workspace/api-client-react";
import { Search, FileCode, Database, Zap, AlertCircle, Loader2 } from "lucide-react";

interface Props {
  projectId: string;
}

const TYPE_ICON: Record<string, JSX.Element> = {
  code:   <FileCode className="h-3.5 w-3.5 text-cyan-400" />,
  schema: <Database className="h-3.5 w-3.5 text-violet-400" />,
  api:    <Zap className="h-3.5 w-3.5 text-amber-400" />,
};

const TYPE_BADGE: Record<string, string> = {
  code:   "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  schema: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  api:    "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.3 ? "bg-emerald-500" : score >= 0.15 ? "bg-amber-500" : "bg-slate-500";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct * 3, 100)}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-slate-400">{score.toFixed(3)}</span>
    </div>
  );
}

export function SemanticSearchPanel({ projectId }: Props) {
  const [inputValue, setInputValue] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const enabled = submittedQuery.trim().length > 0;

  const { data, isFetching, isError, error } = useSemanticSearch(
    { projectId, q: submittedQuery, n: 8 },
    { query: { enabled, staleTime: 30_000 } },
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (trimmed) setSubmittedQuery(trimmed);
  };

  const SUGGESTIONS = [
    "authentication middleware",
    "user model database",
    "order total calculation",
    "email service",
    "product category",
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-cyan-400" />
          <span className="text-xs font-mono font-semibold uppercase tracking-widest text-slate-300">
            Semantic Search
          </span>
        </div>
        {data && (
          <span className="text-xs font-mono text-slate-500">
            {data.indexedDocuments} chunks indexed
          </span>
        )}
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="e.g. authentication middleware, user model…"
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40 font-mono"
          />
        </div>
        <button
          type="submit"
          disabled={!inputValue.trim() || isFetching}
          className="px-4 py-2 text-sm font-mono font-semibold bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 rounded-lg hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>

      {!submittedQuery && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600 font-mono">Try a query:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => { setInputValue(s); setSubmittedQuery(s); }}
                className="px-2.5 py-1 text-xs font-mono bg-slate-800 border border-slate-700 rounded text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-mono">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{String(error) || "Search failed"}</span>
        </div>
      )}

      {isFetching && (
        <div className="flex items-center gap-3 p-4 bg-slate-900 border border-slate-800 rounded-lg">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
          <span className="text-xs font-mono text-slate-400">Computing TF-IDF cosine similarity…</span>
        </div>
      )}

      {data && !isFetching && (
        <div className="space-y-3">
          <p className="text-xs font-mono text-slate-500">
            {data.results.length > 0
              ? `${data.results.length} result${data.results.length !== 1 ? "s" : ""} for "${data.query}"`
              : `No results for "${data.query}" — try ingesting the project first`}
          </p>

          {data.results.map((hit, idx) => {
            const docType = hit.metadata.type ?? "code";
            return (
              <div
                key={hit.id}
                className="border border-slate-800 rounded-lg bg-slate-900/60 overflow-hidden"
              >
                <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 bg-slate-900">
                  <span className="text-xs font-mono text-slate-600">#{idx + 1}</span>
                  {TYPE_ICON[docType] ?? TYPE_ICON["code"]}
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${TYPE_BADGE[docType] ?? TYPE_BADGE["code"]}`}
                  >
                    {docType}
                  </span>
                  <span className="flex-1 text-xs font-mono text-slate-400 truncate">
                    {hit.metadata.file ?? "—"}
                  </span>
                  <ScoreBar score={hit.score} />
                </div>
                <pre className="px-3 py-2.5 text-xs font-mono text-slate-300 whitespace-pre-wrap break-all leading-5 max-h-40 overflow-y-auto">
                  {hit.content}
                </pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
