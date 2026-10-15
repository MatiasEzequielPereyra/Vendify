import type { PlatformRpcClientPort } from "./platform-service.js";
import { normalizeBusinessListInput, parseBusinessDetail, parseBusinessId, parseBusinessPage } from "./business-read-model.js";
import type { BusinessListInput, BusinessPage, PlatformBusiness } from "./business-read-model.js";

export async function listPlatformBusinesses(client: PlatformRpcClientPort, input?: BusinessListInput): Promise<BusinessPage> {
  const request = normalizeBusinessListInput(input);
  const { data, error } = await client.rpc("listar_negocios_plataforma_v2", { p_search: request.query.search, p_plan_codigo: request.query.plan_codigo, p_estado: request.query.estado, p_limit: request.limit, p_cursor: request.cursor });
  if (error) throw new Error("No se pudieron consultar los negocios de plataforma");
  return parseBusinessPage(data, request);
}
export async function getPlatformBusiness(client: PlatformRpcClientPort, businessId: string): Promise<PlatformBusiness | null> {
  const id = parseBusinessId(businessId);
  const { data, error } = await client.rpc("obtener_negocio_plataforma_v1", { p_negocio_id: id });
  if (error) throw new Error("No se pudo consultar el negocio de plataforma");
  return parseBusinessDetail(data, id);
}
