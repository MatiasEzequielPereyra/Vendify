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
    /async function crearEmpleadoV3\(e\) \{[\s\S]*?^\}/gm,
    `async function crearEmpleadoV3(e) {\n  e.preventDefault();\n\n  if (!exigirPermisoV2("manageEmployees", "No tenés permiso para crear empleados")) return;\n\n  const nombre = $("#equipo-nombre").value.trim();\n  const username = normalizarLoginInterno($("#equipo-username").value);\n  const rol = $("#equipo-rol").value;\n  const password = $("#equipo-password").value;\n  const permisoStockSolicitado =\n    appContext.membership?.role === "owner" &&\n    $("#equipo-permiso-stock")?.checked === true;\n  const errorEl = $("#equipo-error");\n  const btn = $("#btn-crear-empleado");\n\n  errorEl.textContent = "";\n  btn.disabled = true;\n  btn.textContent = "Creando...";\n\n  const result = await window.VendifyTeamV232.createEmployee(\n    supabaseClient.functions,\n    { nombre, username, rol, password }\n  );\n\n  btn.disabled = false;\n  btn.textContent = "Crear empleado";\n\n  if (!result.ok) {\n    errorEl.textContent = result.errorMessage || "No se pudo crear el empleado";\n    return;\n  }\n\n  if (appContext.membership?.role === "owner") {\n    try {\n      const people = await listarEquipoV3();\n      const created = people.find(\n        (person) =>\n          String(person.username || "").toLowerCase() === username.toLowerCase()\n      );\n\n      if (created?.membership_id) {\n        await actualizarPermisoStockMiembroV23014(\n          created.membership_id,\n          permisoStockSolicitado\n        );\n      }\n    } catch (permissionError) {\n      console.error("[Equipo] empleado creado, permiso stock pendiente:", permissionError);\n      mostrarToast(\n        "Empleado creado, pero revisá su permiso de stock desde Editar",\n        "info"\n      );\n    }\n  }\n\n  $("#equipo-nombre").value = "";\n  $("#equipo-username").value = "";\n  $("#equipo-password").value = "";\n  if ($("#equipo-permiso-stock")) $("#equipo-permiso-stock").checked = false;\n\n  mostrarToast(\`Empleado @\${username} creado\`, "success");\n  await renderEquipo();\n}`,
    "team create employee handler"
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

  patched = replaceExactlyOnce(
    patched,
    /async function eliminarEmpleadoDefinitivo\(btn\) \{[\s\S]*?^\}/gm,
    `async function eliminarEmpleadoDefinitivo(btn) {\n  if (appContext.membership?.role !== "owner") {\n    mostrarToast("Solo el propietario puede eliminar usuarios", "error");\n    return;\n  }\n\n  const nombre = btn.dataset.nombre || "este empleado";\n  const ok = await confirmar(\n    "Eliminar usuario",\n    \`¿Eliminar definitivamente a \${nombre}? Esta acción elimina su acceso a Vendify.\`\n  );\n\n  if (!ok) return;\n\n  const result = await window.VendifyTeamV232.deleteEmployee(\n    supabaseClient.functions,\n    btn.dataset.id\n  );\n\n  if (!result.ok) {\n    mostrarToast(result.errorMessage || "No se pudo eliminar el usuario", "error");\n    return;\n  }\n\n  mostrarToast("Usuario eliminado definitivamente", "success");\n  await renderEquipo();\n}`,
    "team delete employee handler"
  );

  patched = replaceExactlyOnce(
    patched,
    /async function guardarEdicionEmpleado\(e\) \{[\s\S]*?^\}/gm,
    `async function guardarEdicionEmpleado(e) {\n  e.preventDefault();\n\n  const membershipId = $("#editar-membership-id").value;\n  const nombre = $("#editar-empleado-nombre").value.trim();\n  const username = normalizarLoginInterno($("#editar-empleado-username").value);\n  const rol = $("#editar-empleado-rol").value;\n  const permisoStock =\n    $("#editar-empleado-permiso-stock")?.checked === true;\n  const errorEl = $("#editar-empleado-error");\n  const btn = $("#btn-guardar-editar-empleado");\n\n  errorEl.textContent = "";\n  btn.disabled = true;\n  btn.textContent = "Guardando...";\n\n  const result = await window.VendifyTeamV232.updateEmployee(\n    supabaseClient.functions,\n    { membershipId, nombre, username, rol }\n  );\n\n  btn.disabled = false;\n  btn.textContent = "Guardar cambios";\n\n  if (!result.ok) {\n    errorEl.textContent = result.errorMessage || "No se pudo actualizar";\n    return;\n  }\n\n  if (appContext.membership?.role === "owner") {\n    try {\n      await actualizarPermisoStockMiembroV23014(\n        membershipId,\n        permisoStock\n      );\n    } catch (permissionError) {\n      errorEl.textContent = permissionError.message;\n      return;\n    }\n  }\n\n  cerrarEditarEmpleado();\n  mostrarToast("Empleado actualizado", "success");\n  await renderEquipo();\n}`,
    "team update employee handler"
  );

  patched = replaceExactlyOnce(
    patched,
    /async function reiniciarPasswordEmpleado\(e\) \{[\s\S]*?^\}/gm,
    `async function reiniciarPasswordEmpleado(e) {\n  e.preventDefault();\n\n  const membershipId = $("#reset-membership-id").value;\n  const password = $("#reset-empleado-password").value;\n  const errorEl = $("#reset-empleado-error");\n\n  errorEl.textContent = "";\n\n  const result = await window.VendifyTeamV232.resetEmployeePassword(\n    supabaseClient.functions,\n    membershipId,\n    password\n  );\n\n  if (!result.ok) {\n    errorEl.textContent = result.errorMessage || "No se pudo reiniciar la contraseña";\n    return;\n  }\n\n  cerrarResetEmpleado();\n  mostrarToast("Contraseña del empleado actualizada", "success");\n  await renderEquipo();\n}`,
    "team reset employee password handler"
  );

  return patched;
}
