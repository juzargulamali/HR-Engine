import "server-only";
import { createClient } from "@/lib/supabase/server";

type RpcError = { code?: string; message?: string } | null;
type RpcResult = { data: unknown; error: RpcError };
/**
 * The office board's database functions, called through one loosely typed door. The generated database types describe them once the board's migration is part of them; until then this keeps the
 * Office board page building on its own. Every call runs under the signed-in caller's session, so the database function (not this page) decides who may do what.
 */
export async function opsTvRpc(fn: "ops_tv_list_displays" | "ops_tv_register_display" | "ops_tv_revoke_display", args: Record<string, unknown>): Promise<RpcResult> {
  const supabase = (await createClient()) as unknown as { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };
  return await supabase.rpc(fn, args);
}
