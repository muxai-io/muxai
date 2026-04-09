// Import adapters to trigger auto-registration
import "./claude-local";

// Re-export the registry API
export { getAdapter, registerAdapter } from "./types";
export type { Adapter, AdapterAgent, SpawnConfig, SpawnCallbacks } from "./types";
