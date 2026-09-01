export function patchTeamRefactor(app, replaceExactlyOnce) {
  let patched = app;

  patched = replaceExactlyOnce(
    patched,
    /async function obtenerNegocioAdminV3\(\) \{[\s\S]*?^\}/gm,
    `async function obtenerNegocioAdminV3() {\n  return window.VendifyTeamV232.getAdminBusiness(supabaseClient);\n}`,
    "team admin business service"
  );

  patched = replaceExactlyOnce(
    patched,
    /async function listarEquipoV3\(\) \{[\s\S]*?^\}/gm,
    `async function listarEquipoV3() {\n  const result = await window.VendifyTeamV232.listTeam(supabaseClient);\n  if (result.stockPermissionWarning) {\n    console.warn("[Equipo] permisos stock no disponibles:", result.stockPermissionWarning);\n  }\n  return result.members;\n}`,
    "team list service"
  );

  patched = replaceExactlyOnce(
    patched,
    /async function actualizarPermisoStockMiembroV23014\(membershipId, permitir\) \{[\s\S]*?^\}/gm,
    `async function actualizarPermisoStockMiembroV23014(membershipId, permitir) {\n  const result = await window.VendifyTeamV232.updateStockPermission(\n    supabaseClient,\n    membershipId,\n    permitir\n  );\n  if (!result.ok) {\n    throw new Error(result.errorMessage || "No se pudo actualizar el permiso de stock");\n  }\n  return result.data;\n}`,
    "team stock permission service"
  );

  patched = replaceExactlyOnce(
    patched,
    /async function cambiarRolEquipo\(membershipId, rol, selectEl\) \{[\s\S]*?^\}/gm,
    `async function cambiarRolEquipo(membershipId, rol, selectEl) {\n  selectEl.disabled = true;\n  const result = await window.VendifyTeamV232.updateMemberRole(\n    supabaseClient,\n    membershipId,\n    rol\n  );\n  selectEl.disabled = false;\n\n  if (!result.ok) {\n    mostrarToast(result.errorMessage || "No se pudo actualizar el rol", "error");\n    await renderEquipo();\n    return;\n  }\n  mostrarToast(\`Rol actualizado a \${nombreRolV2(rol)}\`, "success");\n}`,
    "team role mutation"
  );

  patched = replaceExactlyOnce(
    patched,
    /async function cambiarEstadoEquipo\(membershipId, activo\) \{[\s\S]*?^\}/gm,
    `async function cambiarEstadoEquipo(membershipId, activo) {\n  const result = await window.VendifyTeamV232.setMemberActive(\n    supabaseClient,\n    membershipId,\n    activo\n  );\n  if (!result.ok) {\n    mostrarToast(result.errorMessage || "No se pudo actualizar el usuario", "error");\n    return;\n  }\n  mostrarToast(activo ? "Usuario activado" : "Usuario desactivado", "success");\n  await renderEquipo();\n}`,
    "team active mutation"
  );

  return patched;
}
