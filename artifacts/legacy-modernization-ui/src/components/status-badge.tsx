import { Badge } from "@/components/ui/badge";
import { JobStatus } from "@workspace/api-client-react/src/generated/api.schemas";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";

export function StatusBadge({ status }: { status: JobStatus | string }) {
  let icon = null;
  let variantClass = "";

  switch (status) {
    case "completed":
      icon = <CheckCircle2 className="w-3 h-3 mr-1" />;
      variantClass = "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
      break;
    case "running":
      icon = <Loader2 className="w-3 h-3 mr-1 animate-spin" />;
      variantClass = "bg-primary/10 text-primary border-primary/20";
      break;
    case "pending":
      icon = <Clock className="w-3 h-3 mr-1" />;
      variantClass = "bg-secondary/10 text-secondary border-secondary/20";
      break;
    case "failed":
      icon = <XCircle className="w-3 h-3 mr-1" />;
      variantClass = "bg-destructive/10 text-destructive border-destructive/20";
      break;
    default:
      icon = <Clock className="w-3 h-3 mr-1" />;
      variantClass = "bg-muted text-muted-foreground border-muted-foreground/20";
  }

  return (
    <Badge variant="outline" className={cn("uppercase text-[10px] font-mono tracking-wider font-semibold rounded-none border", variantClass)}>
      {icon}
      {status}
    </Badge>
  );
}
