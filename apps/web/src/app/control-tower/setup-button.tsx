"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Radar, Loader2 } from "lucide-react";
import { API_URL, API_KEY } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function SetupButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSetup() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/control-tower`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(API_KEY ? { "X-Api-Key": API_KEY } : {}) },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Setup failed: ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set up Control Tower");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <Button size="lg" onClick={handleSetup} disabled={loading} className="gap-2">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
        {loading ? "Setting up…" : "Set up Control Tower"}
      </Button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
