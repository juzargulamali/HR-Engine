import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { registerAllJarvisActions } from "./actions";
import { createAssistant } from "./assistant";
import { readJarvisConfig } from "./config";
import { defaultNewId, type JarvisDeps } from "./dispatcher";
import { selectProvider } from "./provider";
import { hasSalesGrant, salesCompanies } from "./sales/grants";

/**
 * The production wiring: the signed-in person's own session (cookies -> Supabase anon client with their JWT; RLS applies), the environment configuration, and the module grant
 * checkers. There is no service-role client anywhere in JARVIS.
 */
export const defaultJarvisDeps: JarvisDeps = {
  config: () => readJarvisConfig(),
  provider: (c) => selectProvider(c),
  identity: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user ? { userId: user.id } : null;
  },
  supabase: async () => (await createClient()) as unknown as SupabaseClient,
  // One checker per module. Projects, Inventory and People & HR register theirs here when their actions are added (they are not part of JARVIS yet: no grant ever passes for them).
  moduleGrant: async ({ module, supabase, userId, companyId, capability }) => (module === "sales" ? hasSalesGrant(supabase, userId, companyId, capability) : false),
  companies: ({ supabase, userId }) => salesCompanies(supabase, userId),
  now: () => new Date(),
  newId: defaultNewId,
};

export function getJarvis() {
  registerAllJarvisActions();
  return createAssistant(defaultJarvisDeps);
}
