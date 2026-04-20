import { Link, useLocation } from "wouter";
import { Terminal, FolderGit2, Activity, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Terminal", icon: Terminal },
    { href: "/projects", label: "Projects", icon: FolderGit2 },
    { href: "/jobs", label: "Operations", icon: Activity },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <aside className="w-full md:w-64 border-r border-border bg-sidebar shrink-0 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border shrink-0">
          <Rocket className="w-5 h-5 text-primary mr-3" />
          <h1 className="font-bold text-sm tracking-widest uppercase text-primary">Nexus.Agent</h1>
        </div>
        <nav className="flex-1 py-6 px-3 flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            
            return (
              <Link key={item.href} href={item.href} className="outline-none focus:ring-1 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background">
                <div
                  data-testid={`nav-${item.label.toLowerCase()}`}
                  className={cn(
                    "flex items-center px-3 py-2 text-sm font-medium transition-colors border border-transparent",
                    isActive
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon className="w-4 h-4 mr-3 shrink-0" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 mt-auto border-t border-border/50 text-xs text-muted-foreground font-mono">
          <div>SYS: ONLINE</div>
          <div className="text-primary">NET: SECURE</div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col h-[100dvh] overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
