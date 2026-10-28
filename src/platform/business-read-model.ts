import type { BusinessId } from "../types/ids.js";

export type SubscriptionState = "trial" | "activo" | "vencido" | "suspendido" | "legacy";
export interface BusinessKey { readonly creado: string; readonly id: BusinessId; }
export interface BusinessQuery { readonly search: string | null; readonly plan_codigo: string | null; readonly estado: SubscriptionState | null; }
export interface BusinessCursor {
  readonly version: 1;
  readonly order: "creado_desc_id_desc";
  readonly query: BusinessQuery;
  readonly anchor: BusinessKey;
  readonly after: BusinessKey;
}
export interface PlatformBusiness extends BusinessKey {
  readonly nombre: string;
  readonly activo: boolean;
  readonly suscripcion: null | {
    readonly plan_codigo: string;
    readonly plan_nombre: string;
    readonly estado: SubscriptionState;
    readonly trial_hasta: string | null;
    readonly limites: { readonly sucursales: number | null; readonly usuarios: number | null; readonly productos: number | null; };
  };
  readonly uso: { readonly usuarios: number; readonly sucursales: number; readonly productos: number; };
}
export interface BusinessListInput { readonly search?: string | null; readonly planCode?: string | null; readonly state?: SubscriptionState | null; readonly limit?: number; readonly cursor?: unknown; }
export interface BusinessListRequest { readonly query: BusinessQuery; readonly limit: number; readonly cursor: BusinessCursor | null; }
export interface BusinessPage { readonly contract_version: 1; readonly items: readonly PlatformBusiness[]; readonly next_cursor: BusinessCursor | null; }

function invalid(field: string): never { throw new Error(`Invalid platform business read contract: ${field}`); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function object(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid(field);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) return invalid(field);
  return result;
}
function name(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) return invalid(field);
  return value;
}
export function parseBusinessId(value: unknown): BusinessId {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return invalid("id");
  return value.toLowerCase() as BusinessId;
}
function count(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid(field);
  return value;
}
function state(value: unknown): SubscriptionState {
  if (value === "trial" || value === "activo" || value === "vencido" || value === "suspendido" || value === "legacy") return value;
  return invalid("estado");
}
function plan(value: unknown): string {
  if (typeof value !== "string") return invalid("plan_codigo");
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,49}$/.test(normalized)) return invalid("plan_codigo");
  return normalized;
}
function search(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return invalid("search");
  const normalized = value.trim();
  if (Array.from(normalized).length > 120) return invalid("search");
  return normalized || null;
}
// Preserve PostgreSQL microseconds rather than rounding ordering keys to JS milliseconds.
export function parseBusinessTimestamp(value: unknown): string {
  if (typeof value !== "string") return invalid("timestamp");
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return invalid("timestamp");
  const [, day = "", time = "", fraction = "", zone] = match;
  const local = `${day}T${time}.000Z`;
  const localMs = Date.parse(local);
  if (!Number.isFinite(localMs) || new Date(localMs).toISOString() !== local) return invalid("timestamp");
  let offset = 0;
  if (zone !== "Z" && zone !== undefined) {
    const hours = Number(zone.slice(1, 3));
    const minutes = Number(zone.slice(4, 6));
    if (hours > 23 || minutes > 59) return invalid("timestamp");
    offset = (hours * 60 + minutes) * 60000 * (zone.startsWith("+") ? 1 : -1);
  }
  const utc = new Date(localMs - offset).toISOString();
  if (utc.startsWith("+") || utc.startsWith("-")) return invalid("timestamp");
  return `${utc.slice(0, 19)}.${fraction.padEnd(6, "0")}Z`;
}
function key(value: unknown): BusinessKey {
  const row = object(value, ["creado", "id"], "cursor key");
  const result = { creado: parseBusinessTimestamp(row.creado), id: parseBusinessId(row.id) };
  if (row.creado !== result.creado || row.id !== result.id) return invalid("canonical cursor key");
  return result;
}
function compare(a: BusinessKey, b: BusinessKey): number {
  return a.creado < b.creado ? -1 : a.creado > b.creado ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
export function parseBusinessCursor(value: unknown, query: BusinessQuery): BusinessCursor {
  const row = object(value, ["version", "order", "query", "anchor", "after"], "cursor");
  const filter = object(row.query, ["search", "plan_codigo", "estado"], "cursor query");
  if (row.version !== 1 || row.order !== "creado_desc_id_desc" || filter.search !== query.search || filter.plan_codigo !== query.plan_codigo || filter.estado !== query.estado) return invalid("cursor query/order");
  const anchor = key(row.anchor);
  const after = key(row.after);
  if (compare(after, anchor) > 0) return invalid("cursor bounds");
  return { version: 1, order: "creado_desc_id_desc", query, anchor, after };
}
export function normalizeBusinessListInput(input: BusinessListInput = {}): BusinessListRequest {
  if (!isRecord(input) || Object.keys(input).some((key) => !["search", "planCode", "state", "limit", "cursor"].includes(key))) return invalid("list input");
  const query = { search: search(input.search), plan_codigo: input.planCode == null ? null : plan(input.planCode), estado: input.state == null ? null : state(input.state) };
  const limit = Object.hasOwn(input, "limit") ? input.limit : 50;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) return invalid("limit");
  return { query, limit, cursor: input.cursor == null ? null : parseBusinessCursor(input.cursor, query) };
}
function parseBusiness(value: unknown): PlatformBusiness {
  const row = object(value, ["id", "nombre", "creado", "activo", "suscripcion", "uso"], "business");
  if (typeof row.activo !== "boolean") return invalid("activo");
  const usage = object(row.uso, ["usuarios", "sucursales", "productos"], "uso");
  let subscription: PlatformBusiness["suscripcion"] = null;
  if (row.suscripcion !== null) {
    const sub = object(row.suscripcion, ["plan_codigo", "plan_nombre", "estado", "trial_hasta", "limites"], "suscripcion");
    const limits = object(sub.limites, ["usuarios", "sucursales", "productos"], "limites");
    const planCode = plan(sub.plan_codigo);
    if (planCode !== sub.plan_codigo) return invalid("canonical plan_codigo");
    subscription = { plan_codigo: planCode, plan_nombre: name(sub.plan_nombre, "plan_nombre"), estado: state(sub.estado), trial_hasta: sub.trial_hasta === null ? null : parseBusinessTimestamp(sub.trial_hasta), limites: { usuarios: limits.usuarios === null ? null : count(limits.usuarios, "usuarios limit"), sucursales: limits.sucursales === null ? null : count(limits.sucursales, "sucursales limit"), productos: limits.productos === null ? null : count(limits.productos, "productos limit") } };
  }
  return { id: parseBusinessId(row.id), nombre: name(row.nombre, "nombre"), creado: parseBusinessTimestamp(row.creado), activo: row.activo, suscripcion: subscription, uso: { usuarios: count(usage.usuarios, "usuarios usage"), sucursales: count(usage.sucursales, "sucursales usage"), productos: count(usage.productos, "productos usage") } };
}
export function parseBusinessPage(value: unknown, request: BusinessListRequest): BusinessPage {
  const row = object(value, ["contract_version", "items", "next_cursor"], "page");
  if (row.contract_version !== 1 || !Array.isArray(row.items) || row.items.length > request.limit) return invalid("page version/size");
  const items = row.items.map(parseBusiness);
  const ids = new Set<string>();
  let previous = request.cursor?.after;
  for (const item of items) {
    if (ids.has(item.id) || (previous && compare(item, previous) >= 0) || (request.cursor && compare(item, request.cursor.anchor) > 0)) return invalid("page order/duplicates");
    ids.add(item.id);
    previous = item;
  }
  const next = row.next_cursor === null ? null : parseBusinessCursor(row.next_cursor, request.query);
  if (next) {
    const last = items.at(-1);
    const anchor = request.cursor?.anchor ?? items[0];
    if (!last || !anchor || compare(next.after, last) !== 0 || compare(next.anchor, anchor) !== 0) return invalid("next cursor boundary");
  }
  return { contract_version: 1, items, next_cursor: next };
}
export function parseBusinessDetail(value: unknown, id: BusinessId): PlatformBusiness | null {
  const row = object(value, ["contract_version", "business"], "detail");
  if (row.contract_version !== 1) return invalid("detail version");
  if (row.business === null) return null;
  const business = parseBusiness(row.business);
  if (business.id !== id) return invalid("detail identity");
  return business;
}
