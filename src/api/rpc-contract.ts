/**
 * Typed RPC wrappers will progressively move here.
 *
 * Phase 0 intentionally does not replace the production Supabase client.
 * The current RPC inventory is tracked in contracts/rpc-contract.json.
 */
export interface RpcFailure {
  readonly message: string;
  readonly code?: string;
}

export type RpcResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: RpcFailure };
