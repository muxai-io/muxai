"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          {error.message || "An unexpected error occurred. This is usually caused by a failed API request."}
        </p>
      </div>
      <Button onClick={reset} variant="outline" size="sm">
        Try again
      </Button>
    </div>
  );
}
