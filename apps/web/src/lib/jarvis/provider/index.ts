import "server-only";
import type { JarvisConfig } from "../config";
import { simulatedAllowed } from "../config";
import { createAnthropicProvider } from "./anthropic";
import { createSimulatedProvider } from "./simulated";
import type { JarvisProvider } from "./types";

/** The provider this configuration selects, or null when none is usable. The simulated provider is refused in production (checked again here, not only in the config). */
export function selectProvider(config: JarvisConfig, env: Record<string, string | undefined> = process.env): JarvisProvider | null {
  if (config.providerKind === "simulated") return simulatedAllowed(env) ? createSimulatedProvider() : null;
  if (config.providerKind === "anthropic" && config.apiKey) return createAnthropicProvider({ apiKey: config.apiKey, model: config.model });
  return null;
}

export type { JarvisProvider } from "./types";
export { JarvisProviderError } from "./types";
