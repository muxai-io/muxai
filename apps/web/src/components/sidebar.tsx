"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { LayoutDashboard, PlusCircle, Plug, Radio, FlaskConical, Users, UsersRound, FileJson, Settings, Handshake, MessageSquare, Rocket, Radar } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

const platformNav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/control-tower", label: "Control Tower", icon: Radar },
  { href: "/mcp-servers", label: "MCP Servers", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

const agentsNav: NavItem[] = [
  { href: "/agents/new", label: "New Agent", icon: PlusCircle, exact: true },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/contractors", label: "Contractors", icon: Handshake },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

const teamsNav: NavItem[] = [
  { href: "/teams/deploy", label: "Deploy Team", icon: Rocket, exact: true },
  { href: "/teams", label: "Teams", icon: UsersRound },
];

export function Sidebar() {
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const logoSrc = mounted && resolvedTheme === "light" ? "/ai_agents_multiplexer_dark.png" : "/ai_agents_multiplexer.png";

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    if (href === "/agents") {
      // Active for /agents and /agents/[id] but NOT /agents/new or /agents/[id]/edit
      return pathname === "/agents" || (pathname.startsWith("/agents/") && !pathname.endsWith("/new") && !pathname.includes("/edit"));
    }
    if (href === "/teams") {
      return pathname === "/teams";
    }
    return pathname.startsWith(href);
  }

  return (
    <aside className="w-56 border-r border-border bg-background flex flex-col">
      {/* Brand */}
      <div className="flex items-center px-5 py-5 border-b border-border">
        <Image src={logoSrc} alt="muxAI" width={0} height={0} sizes="100vw" style={{ height: "22px", width: "auto" }} />
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-4 overflow-y-auto">
        {/* Platform */}
        <div className="space-y-0.5">
          <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest">Platform</p>
          {platformNav.map(({ href, label, icon: Icon, exact }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(href, exact) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4", isActive(href, exact) ? "text-primary" : "text-muted-foreground")} />
              {label}
            </Link>
          ))}
        </div>

        {/* Agents */}
        <div className="space-y-0.5">
          <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest">Agents</p>
          {agentsNav.map(({ href, label, icon: Icon, exact }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(href, exact) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4", isActive(href, exact) ? "text-primary" : "text-muted-foreground")} />
              {label}
            </Link>
          ))}
        </div>

        {/* Teams */}
        <div className="space-y-0.5">
          <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest">Teams</p>
          {teamsNav.map(({ href, label, icon: Icon, exact }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(href, exact) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4", isActive(href, exact) ? "text-primary" : "text-muted-foreground")} />
              {label}
            </Link>
          ))}
        </div>

        <div className="border-t border-border" />

        {/* Tools */}
        <div className="space-y-0.5">
          <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest">Tools & Plugins</p>
          <Link
            href="/sandbox"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive("/sandbox") ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
            )}
          >
            <FlaskConical className={cn("h-4 w-4", isActive("/sandbox") ? "text-foreground" : "text-muted-foreground")} />
            Sandbox
          </Link>
          <Link
            href="/results"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive("/results") ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
            )}
          >
            <FileJson className={cn("h-4 w-4", isActive("/results") ? "text-foreground" : "text-muted-foreground")} />
            Results
          </Link>
          <Link
            href="/streams"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive("/streams") ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
            )}
          >
            <Radio className={cn("h-4 w-4", isActive("/streams") ? "text-foreground" : "text-muted-foreground")} />
            Stream History
          </Link>
        </div>
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-border">
        <p className="text-xs text-muted-foreground/50 font-mono">v2026.1.3</p>
      </div>
    </aside>
  );
}
