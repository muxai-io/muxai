"use client";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun, Palette, Users2, Plus, Trash2, Wallet, Bell, ChevronDown, ChevronRight, Hash, Rss, Server } from "lucide-react";
import Image from "next/image";
import { apiFetch, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentRole {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
}

// ─── Sections ─────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "display", label: "Display", icon: Palette },
  { id: "agents", label: "Agents", icon: Users2 },
  { id: "mcp", label: "MCP", icon: Server },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "x402", label: "x402", icon: Wallet },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

// ─── Display Section ──────────────────────────────────────────────────────────

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

function DisplaySection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Display</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Customize the appearance of the platform.</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm">Theme</CardTitle>
          <CardDescription>Choose how muxai looks to you.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 max-w-sm">
            {THEMES.map(({ value, label, icon: Icon }) => {
              const active = mounted && theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className={cn(
                    "flex flex-col items-center gap-2.5 rounded-lg border p-4 transition-colors text-sm font-medium",
                    active
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border hover:border-primary/40 hover:bg-muted/50 text-muted-foreground"
                  )}
                >
                  <Icon className={cn("h-5 w-5", active ? "text-primary" : "")} />
                  {label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Agents Section ───────────────────────────────────────────────────────────

function AgentsSection() {
  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<AgentRole[]>("/api/roles")
      .then(setRoles)
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/roles", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      setName("");
      setDescription("");
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add role");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await apiFetch(`/api/roles/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Agents</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Configure platform-wide agent settings.</p>
      </div>

      {/* Roles */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-sm">Roles</CardTitle>
              <CardDescription className="mt-1">
                Roles appear in the agent create and edit forms. Deleting a role does not affect agents already using it.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => setShowAdd((v) => !v)}>
              <Plus className="h-3.5 w-3.5" />
              Add Role
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add form */}
          {showAdd && (
            <form onSubmit={handleAdd} className="rounded-lg border border-border p-4 space-y-4 bg-muted/20">
              <p className="text-sm font-medium">New Role</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="role-name">Name *</Label>
                  <Input
                    id="role-name"
                    required
                    placeholder="e.g. risk-manager"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Lowercase, no spaces</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role-desc">Description <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="role-desc"
                    placeholder="What does this role do?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={saving}>{saving ? "Adding…" : "Add Role"}</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setShowAdd(false); setError(null); }}>Cancel</Button>
              </div>
            </form>
          )}

          {/* Role list */}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roles yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {roles.map((role) => (
                <li key={role.id} className="flex items-center justify-between gap-4 px-4 py-3 bg-background">
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="secondary" className="font-mono shrink-0">{role.name}</Badge>
                    {role.description && (
                      <span className="text-sm text-muted-foreground truncate">{role.description}</span>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(role.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── MCP Section ─────────────────────────────────────────────────────────────

interface NewsFeed { name: string; url: string; }
interface CurrencyTerms { [symbol: string]: string[]; }

const DEFAULT_FEEDS: NewsFeed[] = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
  { name: "The Block", url: "https://www.theblock.co/rss.xml" },
  { name: "Blockworks", url: "https://blockworks.co/feed" },
  { name: "Bitcoin Sistemi", url: "https://en.bitcoinsistemi.com/feed/" },
  { name: "AMBCrypto", url: "https://ambcrypto.com/feed/" },
  { name: "Cryptopolitan", url: "https://www.cryptopolitan.com/feed/" },
];

const DEFAULT_CURRENCY_TERMS: CurrencyTerms = {
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "eth", "ether"],
  SOL: ["solana", "sol"],
  BNB: ["binance", "bnb"],
  XRP: ["ripple", "xrp"],
  ADA: ["cardano", "ada"],
  DOGE: ["dogecoin", "doge"],
  AVAX: ["avalanche", "avax"],
  DOT: ["polkadot", "dot"],
  MATIC: ["polygon", "matic"],
  LINK: ["chainlink", "link"],
  UNI: ["uniswap", "uni"],
  ATOM: ["cosmos", "atom"],
  LTC: ["litecoin", "ltc"],
  SHIB: ["shiba", "shib"],
  PEPE: ["pepe"],
};

const CORE_SERVERS = ["wallet", "orchestrator"];
const BUILTIN_SERVERS = [
  { id: "news-analyst", label: "News Analyst", description: "Fetches cryptocurrency news from RSS feeds" },
  { id: "chart-analyst", label: "Chart Analyst", description: "Fetches trading charts for technical analysis" },
  { id: "contractor", label: "Contractor", description: "Consults hired external models via OpenRouter" },
  { id: "orchestrator", label: "Orchestrator", description: "Team coordination — invoke direct reports" },
  { id: "wallet", label: "Wallet", description: "Solana wallet access and x402 payments" },
  { id: "docs", label: "Docs", description: "Search and read muxAI platform documentation" },
];

function McpSection() {
  const [feeds, setFeeds] = useState<NewsFeed[]>([]);
  const [currencyTerms, setCurrencyTerms] = useState<CurrencyTerms>({});
  const [disabledServers, setDisabledServers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Card collapse state
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({ servers: true, feeds: false, currencies: false });
  function toggleCard(key: string) { setOpenCards((p) => ({ ...p, [key]: !p[key] })); }

  // Feed add form
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");

  // Currency add form
  const [showAddCurrency, setShowAddCurrency] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [newTerms, setNewTerms] = useState("");

  useEffect(() => {
    apiFetch<Record<string, string>>("/api/settings")
      .then((s) => {
        setFeeds(s.mcp_news_feeds ? JSON.parse(s.mcp_news_feeds) : DEFAULT_FEEDS);
        setCurrencyTerms(s.mcp_currency_terms ? JSON.parse(s.mcp_currency_terms) : DEFAULT_CURRENCY_TERMS);
        setDisabledServers(s.mcp_disabled_servers ? JSON.parse(s.mcp_disabled_servers) : []);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          mcp_news_feeds: JSON.stringify(feeds),
          mcp_currency_terms: JSON.stringify(currencyTerms),
          mcp_disabled_servers: JSON.stringify(disabledServers),
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function removeFeed(idx: number) {
    setFeeds((f) => f.filter((_, i) => i !== idx));
  }

  function addFeed(e: React.FormEvent) {
    e.preventDefault();
    if (!feedName.trim() || !feedUrl.trim()) return;
    setFeeds((f) => [...f, { name: feedName.trim(), url: feedUrl.trim() }]);
    setFeedName("");
    setFeedUrl("");
    setShowAddFeed(false);
  }

  function removeCurrency(symbol: string) {
    setCurrencyTerms((c) => {
      const next = { ...c };
      delete next[symbol];
      return next;
    });
  }

  function addCurrency(e: React.FormEvent) {
    e.preventDefault();
    const symbol = newSymbol.trim().toUpperCase();
    const terms = newTerms.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!symbol || terms.length === 0) return;
    setCurrencyTerms((c) => ({ ...c, [symbol]: terms }));
    setNewSymbol("");
    setNewTerms("");
    setShowAddCurrency(false);
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">MCP</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Configure data sources used by built-in MCP servers.</p>
      </div>

      {/* Built-in Servers */}
      <Card>
        <button type="button" className="w-full text-left" onClick={() => toggleCard("servers")}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-sm">Built-in Servers</CardTitle>
                <CardDescription className="mt-1">
                  Toggle built-in MCP servers on or off globally. Changes take effect on the next agent run.
                </CardDescription>
              </div>
              {openCards.servers ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
            </div>
          </CardHeader>
        </button>
        {openCards.servers && (
          <CardContent>
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {BUILTIN_SERVERS.map((server) => {
                const isCore = CORE_SERVERS.includes(server.id);
                const isEnabled = !disabledServers.includes(server.id);
                return (
                  <li key={server.id} className="flex items-center justify-between gap-4 px-4 py-3 bg-background">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-none">{server.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{server.description}</p>
                    </div>
                    <Switch
                      checked={isEnabled}
                      disabled={isCore}
                      onCheckedChange={(checked) => {
                        setDisabledServers((prev) =>
                          checked ? prev.filter((id) => id !== server.id) : [...prev, server.id]
                        );
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        )}
      </Card>

      {/* News Feeds */}
      <Card>
        <button type="button" className="w-full text-left" onClick={() => toggleCard("feeds")}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-sm">News Feeds</CardTitle>
                <CardDescription className="mt-1">
                  RSS feeds used by the News Analyst MCP server. Changes take effect on the next agent run.
                </CardDescription>
              </div>
              {openCards.feeds ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
            </div>
          </CardHeader>
        </button>
        {openCards.feeds && <CardContent className="space-y-4">
          {!showAddFeed && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAddFeed(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add Feed
            </Button>
          )}
          {showAddFeed && (
            <form onSubmit={addFeed} className="rounded-lg border border-border p-4 space-y-4 bg-muted/20">
              <p className="text-sm font-medium">New Feed</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="feed-name">Name *</Label>
                  <Input id="feed-name" required placeholder="e.g. CoinDesk" value={feedName} onChange={(e) => setFeedName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="feed-url">RSS URL *</Label>
                  <Input id="feed-url" required type="url" placeholder="https://example.com/rss" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm">Add Feed</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setShowAddFeed(false)}>Cancel</Button>
              </div>
            </form>
          )}

          {feeds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feeds configured.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {feeds.map((feed, i) => (
                <li key={i} className="flex items-center justify-between gap-4 px-4 py-3 bg-background">
                  <div className="flex items-center gap-3 min-w-0">
                    <Rss className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-none">{feed.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">{feed.url}</p>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeFeed(i)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>}
      </Card>

      {/* Currency Terms */}
      <Card>
        <button type="button" className="w-full text-left" onClick={() => toggleCard("currencies")}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-sm">Currency Terms</CardTitle>
                <CardDescription className="mt-1">
                  Search terms used to match news articles to currencies. The News Analyst filters articles by these keywords.
                </CardDescription>
              </div>
              {openCards.currencies ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
            </div>
          </CardHeader>
        </button>
        {openCards.currencies && <CardContent className="space-y-4">
          {!showAddCurrency && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAddCurrency(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add Currency
            </Button>
          )}
          {showAddCurrency && (
            <form onSubmit={addCurrency} className="rounded-lg border border-border p-4 space-y-4 bg-muted/20">
              <p className="text-sm font-medium">New Currency</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="currency-symbol">Symbol *</Label>
                  <Input id="currency-symbol" required placeholder="e.g. BTC" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="currency-terms">Search Terms *</Label>
                  <Input id="currency-terms" required placeholder="bitcoin, btc" value={newTerms} onChange={(e) => setNewTerms(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Comma-separated, lowercase</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm">Add Currency</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setShowAddCurrency(false)}>Cancel</Button>
              </div>
            </form>
          )}

          {Object.keys(currencyTerms).length === 0 ? (
            <p className="text-sm text-muted-foreground">No currencies configured.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {Object.entries(currencyTerms).map(([symbol, terms]) => (
                <li key={symbol} className="flex items-center justify-between gap-4 px-4 py-3 bg-background">
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="secondary" className="font-mono shrink-0">{symbol}</Badge>
                    <span className="text-sm text-muted-foreground truncate">{terms.join(", ")}</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeCurrency(symbol)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>}
      </Card>

      <Button size="sm" disabled={saving} onClick={handleSave}>
        {saved ? "Saved!" : saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

// ─── Notifications Section ────────────────────────────────────────────────────

interface NotificationChannel {
  id: string;
  name: string;
  channel: "discord";
  webhookUrl: string;
  enabled: boolean;
}

function NotificationsSection() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const settings = await apiFetch<Record<string, string>>("/api/settings");
      const raw = settings.notification_channels;
      setChannels(raw ? JSON.parse(raw) : []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function save(updated: NotificationChannel[]) {
    await apiFetch("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ notification_channels: JSON.stringify(updated) }),
    });
    setChannels(updated);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const newChannel: NotificationChannel = {
        id: crypto.randomUUID(),
        name: name.trim(),
        channel: "discord",
        webhookUrl: webhookUrl.trim(),
        enabled: true,
      };
      await save([...channels, newChannel]);
      setName("");
      setWebhookUrl("");
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add channel");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    await save(channels.map((c) => c.id === id ? { ...c, enabled } : c));
  }

  async function handleDelete(id: string) {
    await save(channels.filter((c) => c.id !== id));
  }

  const addForm = (
    <form onSubmit={handleAdd} className="rounded-lg border border-border p-4 space-y-4 bg-muted/20">
      <p className="text-sm font-medium">New Channel</p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="channel-name">Name *</Label>
          <Input
            id="channel-name"
            required
            placeholder="e.g. Trading Alerts"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/30 text-sm text-muted-foreground">
            <Hash className="h-3.5 w-3.5" />
            Discord Webhook
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="channel-url">Webhook URL *</Label>
          <Input
            id="channel-url"
            required
            type="url"
            placeholder="https://discord.com/api/webhooks/..."
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            In Discord: Channel Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL
          </p>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>{saving ? "Adding…" : "Add Channel"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => { setShowAdd(false); setError(null); }}>Cancel</Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Configure where agents send alerts when events occur.</p>
      </div>

      <Card className="border-muted bg-muted/20">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">How notifications work:</span> Add one or more channels here — each channel is a destination like a Discord webhook. Channels are <span className="italic">global</span>; they are shared across all agents. On the agent detail page, each agent independently chooses which events it wants to fire: <span className="font-medium text-foreground">Decision</span> (agent captured a result), <span className="font-medium text-foreground">Error</span> (run failed), and <span className="font-medium text-foreground">Run End</span> (run completed). Only enabled channels receive messages.
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : channels.length === 0 ? (
        <div className="space-y-4">
          {showAdd ? addForm : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                  <Bell className="h-5 w-5 text-amber-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">No notification channels</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Add a channel to start receiving agent alerts.</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 mt-1" onClick={() => setShowAdd(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Add Channel
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm">Channels</CardTitle>
                {!showAdd && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAdd(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Channel
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {channels.map((ch) => (
                  <li key={ch.id} className="flex items-center justify-between gap-4 px-4 py-3 bg-background">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-500/10 shrink-0">
                        <Hash className="h-3.5 w-3.5 text-indigo-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-none">{ch.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{ch.webhookUrl}</p>
                      </div>
                      <Badge variant="secondary" className="shrink-0 capitalize">{ch.channel}</Badge>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Switch
                        checked={ch.enabled}
                        onCheckedChange={(v) => handleToggle(ch.id, v)}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(ch.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {showAdd ? addForm : (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add another channel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── x402 Section ────────────────────────────────────────────────────────────

function X402Section() {
  const [solanaNetwork, setSolanaNetwork] = useState("devnet");
  const [solanaRpc, setSolanaRpc] = useState("https://api.devnet.solana.com");
  const [baseNetwork, setBaseNetwork] = useState("mainnet");
  const [baseRpc, setBaseRpc] = useState("https://mainnet.base.org");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [solanaOpen, setSolanaOpen] = useState(false);
  const [baseOpen, setBaseOpen] = useState(false);

  useEffect(() => {
    apiFetch<Record<string, string>>("/api/settings")
      .then((s) => {
        if (s.solana_network) setSolanaNetwork(s.solana_network);
        if (s.solana_rpc_url) setSolanaRpc(s.solana_rpc_url);
        if (s.base_network) setBaseNetwork(s.base_network);
        if (s.base_rpc_url) setBaseRpc(s.base_rpc_url);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          solana_network: solanaNetwork,
          solana_rpc_url: solanaRpc,
          base_network: baseNetwork,
          base_rpc_url: baseRpc,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">x402</h2>
        <p className="text-sm text-muted-foreground mt-0.5">RPC configuration for agent wallet balance display.</p>
      </div>

      <Card className="border-muted bg-muted/20">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">How x402 payments work:</span> When an agent calls a paid API, the server responds with a 402 that specifies exactly which network and token it accepts. The agent pays on that network automatically — regardless of what is configured here. Setting this to mainnet does <span className="italic">not</span> mean payments always go to mainnet; if the API asks for devnet, the agent pays on devnet.
            <br /><br />
            These RPC settings only control how <span className="font-medium text-foreground">wallet balances are displayed</span> in the agent detail page. Set them to match the network your agent wallets are funded on so balances show correctly.
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          <Card>
            <button
              type="button"
              onClick={() => setSolanaOpen((v) => !v)}
              className="w-full flex items-center gap-3 px-6 py-4 text-left"
            >
              <Image src="/solana.png" alt="Solana" width={20} height={20} className="shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Solana</p>
                {!solanaOpen && <p className="text-xs text-muted-foreground">{solanaNetwork} · {solanaRpc}</p>}
              </div>
              {solanaOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {solanaOpen && (
              <CardContent className="space-y-4 max-w-sm pt-0 pb-4">
                <CardDescription className="pb-2">RPC used to display SOL and USDC balances for agent wallets.</CardDescription>
                <div className="space-y-1.5">
                  <Label htmlFor="solana-network">Network</Label>
                  <select
                    id="solana-network"
                    value={solanaNetwork}
                    onChange={(e) => setSolanaNetwork(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="devnet">devnet</option>
                    <option value="mainnet-beta">mainnet-beta</option>
                  </select>
                  <p className="text-xs text-muted-foreground">Set this to match whichever network your Solana wallet is funded on.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="solana-rpc">RPC URL</Label>
                  <Input
                    id="solana-rpc"
                    value={solanaRpc}
                    onChange={(e) => setSolanaRpc(e.target.value)}
                    placeholder="https://api.devnet.solana.com"
                  />
                  <p className="text-xs text-muted-foreground">Use a private RPC for production — public endpoints are rate limited.</p>
                </div>
              </CardContent>
            )}
          </Card>

          <Card>
            <button
              type="button"
              onClick={() => setBaseOpen((v) => !v)}
              className="w-full flex items-center gap-3 px-6 py-4 text-left"
            >
              <Image src="/base.png" alt="Base" width={20} height={20} className="shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Base</p>
                {!baseOpen && <p className="text-xs text-muted-foreground">{baseNetwork} · {baseRpc}</p>}
              </div>
              {baseOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {baseOpen && (
              <CardContent className="space-y-4 max-w-sm pt-0 pb-4">
                <CardDescription className="pb-2">RPC used to display ETH and USDC balances for agent EVM wallets.</CardDescription>
                <div className="space-y-1.5">
                  <Label htmlFor="base-network">Network</Label>
                  <select
                    id="base-network"
                    value={baseNetwork}
                    onChange={(e) => setBaseNetwork(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="mainnet">mainnet</option>
                    <option value="testnet">testnet (Base Sepolia)</option>
                  </select>
                  <p className="text-xs text-muted-foreground">Set this to match whichever network your Base wallet is funded on.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="base-rpc">RPC URL</Label>
                  <Input
                    id="base-rpc"
                    value={baseRpc}
                    onChange={(e) => setBaseRpc(e.target.value)}
                    placeholder="https://mainnet.base.org"
                  />
                  <p className="text-xs text-muted-foreground">Use a private RPC for production — public endpoints are rate limited.</p>
                </div>
              </CardContent>
            )}
          </Card>

          <Button type="submit" size="sm" disabled={saving}>
            {saved ? "Saved!" : saving ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [active, setActive] = useState<SectionId>("display");

  return (
    <div className="flex gap-8 h-full">
      {/* Left nav */}
      <nav className="w-44 shrink-0 space-y-1 pt-0.5">
        <p className="px-3 pb-2 text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest">Settings</p>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={cn(
              "w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-left",
              active === id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
            )}
          >
            <Icon className={cn("h-4 w-4", active === id ? "text-foreground" : "text-muted-foreground")} />
            {label}
          </button>
        ))}
      </nav>

      {/* Divider */}
      <div className="w-px bg-border shrink-0" />

      {/* Content */}
      <div className="flex-1 max-w-2xl">
        {active === "display" && <DisplaySection />}
        {active === "agents" && <AgentsSection />}
        {active === "mcp" && <McpSection />}
        {active === "notifications" && <NotificationsSection />}
        {active === "x402" && <X402Section />}
      </div>
    </div>
  );
}
