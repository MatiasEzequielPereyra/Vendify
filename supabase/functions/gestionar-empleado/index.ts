import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalize(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

type TeamRole = "owner" | "admin" | "manager" | "cashier";

function isTeamRole(value: string): value is TeamRole {
  return value === "owner" || value === "admin" || value === "manager" || value === "cashier";
}

function canManageTarget(actorRole: TeamRole, targetRole: TeamRole): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner" || actorRole === "admin") return true;
  return actorRole === "manager" && (targetRole === "manager" || targetRole === "cashier");
}

function canDeleteTarget(actorRole: TeamRole, targetRole: TeamRole): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  return (actorRole === "admin" || actorRole === "manager") &&
    (targetRole === "manager" || targetRole === "cashier");
}

function canAssignRole(actorRole: TeamRole, role: TeamRole): boolean {
  if (role === "owner") return false;
  if (actorRole === "owner" || actorRole === "admin") return true;
  return actorRole === "manager" && (role === "manager" || role === "cashier");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Sesión requerida");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceRole);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Sesión inválida");

    const { data: callerMembership, error: callerError } = await admin
      .from("negocio_miembros")
      .select("negocio_id, rol, activo")
      .eq("user_id", user.id)
      .eq("activo", true)
      .in("rol", ["owner", "admin", "manager"])
      .limit(1)
      .maybeSingle();

    if (callerError || !callerMembership) {
      throw new Error("No tenés permiso para administrar empleados");
    }

    const body = await req.json();
    const action = String(body.action || "");
    const membershipId = String(body.membership_id || "");

    if (!membershipId) throw new Error("Empleado inválido");

    const { data: targetMembership, error: targetError } = await admin
      .from("negocio_miembros")
      .select("id, negocio_id, user_id, rol, activo")
      .eq("id", membershipId)
      .eq("negocio_id", callerMembership.negocio_id)
      .maybeSingle();

    if (targetError || !targetMembership) throw new Error("Empleado inexistente");
    if (!isTeamRole(callerMembership.rol) || !isTeamRole(targetMembership.rol)) {
      throw new Error("Rol inválido");
    }
    if (targetMembership.user_id === user.id) {
      throw new Error("No podés modificar tu propia cuenta desde Equipo");
    }
    if (!canManageTarget(callerMembership.rol, targetMembership.rol)) {
      throw new Error("No tenés permiso para administrar ese usuario");
    }

    const { data: empleado, error: employeeError } = await admin
      .from("empleados")
      .select("id, username, nombre, debe_cambiar_password, activo")
      .eq("negocio_id", callerMembership.negocio_id)
      .eq("user_id", targetMembership.user_id)
      .maybeSingle();

    if (employeeError || !empleado) throw new Error("El perfil del empleado no existe");

    if (action === "delete") {
      if (!canDeleteTarget(callerMembership.rol, targetMembership.rol)) {
        throw new Error("No tenés permiso para eliminar ese usuario");
      }

      // La auditoría es fail-closed y ocurre antes de la operación irreversible en Auth.
      const { error: auditError } = await admin.from("audit_log").insert({
        negocio_id: callerMembership.negocio_id,
        user_id: user.id,
        accion: "empleado_eliminado",
        entidad: "empleados",
        entidad_id: empleado.id,
        detalle: {
          actor_role: callerMembership.rol,
          target_user_id: targetMembership.user_id,
          username: empleado.username,
          nombre: empleado.nombre,
          rol: targetMembership.rol,
        },
      });
      if (auditError) throw auditError;

      // auth.users tiene cascadas hacia empleados/negocio_miembros.
      const { error: deleteError } =
        await admin.auth.admin.deleteUser(targetMembership.user_id);

      if (deleteError) throw new Error(deleteError.message);

      return new Response(JSON.stringify({ ok: true, action: "delete" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update") {
      const nombre = String(body.nombre || "").trim();
      const username = normalize(body.username);
      const rol = String(body.rol || "");

      if (nombre.length < 2) throw new Error("Ingresá un nombre válido");
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
        throw new Error("El usuario debe tener entre 3 y 30 caracteres");
      }
      if (!isTeamRole(rol) || !canAssignRole(callerMembership.rol, rol)) {
        throw new Error("No tenés permiso para asignar ese rol");
      }

      const { data: duplicate } = await admin
        .from("empleados")
        .select("id")
        .eq("negocio_id", callerMembership.negocio_id)
        .ilike("username", username)
        .neq("id", empleado.id)
        .maybeSingle();

      if (duplicate) throw new Error("Ese nombre de usuario ya está en uso");

      const { data: negocio, error: negocioError } = await admin
        .from("negocios")
        .select("codigo_acceso")
        .eq("id", callerMembership.negocio_id)
        .single();

      if (negocioError || !negocio?.codigo_acceso) throw new Error("El negocio no tiene código de acceso");

      // Registrar el cambio antes de cualquier mutación de Auth/DB.
      const { error: auditError } = await admin.from("audit_log").insert({
        negocio_id: callerMembership.negocio_id,
        user_id: user.id,
        accion: "empleado_actualizado",
        entidad: "empleados",
        entidad_id: empleado.id,
        detalle: {
          actor_role: callerMembership.rol,
          target_user_id: targetMembership.user_id,
          nombre_anterior: empleado.nombre,
          nombre_nuevo: nombre,
          username_anterior: empleado.username,
          username_nuevo: username,
          rol_anterior: targetMembership.rol,
          rol_nuevo: rol,
        },
      });
      if (auditError) throw auditError;

      // El username forma parte del email técnico usado por Supabase Auth.
      if (username !== normalize(empleado.username)) {
        const code = normalize(negocio.codigo_acceso);
        const internalEmail = `${code}.${username}@employees.vendify.internal`;

        const { error: authUpdateError } = await admin.auth.admin.updateUserById(
          targetMembership.user_id,
          { email: internalEmail, email_confirm: true }
        );

        if (authUpdateError) throw new Error(authUpdateError.message);
      }

      const { error: empUpdateError } = await admin
        .from("empleados")
        .update({
          nombre,
          username,
          actualizado: new Date().toISOString(),
        })
        .eq("id", empleado.id);

      if (empUpdateError) throw empUpdateError;

      const { error: roleError } = await admin
        .from("negocio_miembros")
        .update({ rol })
        .eq("id", membershipId);

      if (roleError) throw roleError;

      return new Response(JSON.stringify({ ok: true, action: "update" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "reset_password") {
      const password = String(body.password || "");
      if (password.length < 8) throw new Error("La contraseña temporal debe tener al menos 8 caracteres");

      // La contraseña no se audita; sólo actor, target y username.
      const { error: auditError } = await admin.from("audit_log").insert({
        negocio_id: callerMembership.negocio_id,
        user_id: user.id,
        accion: "password_empleado_reiniciada",
        entidad: "empleados",
        entidad_id: empleado.id,
        detalle: {
          actor_role: callerMembership.rol,
          target_user_id: targetMembership.user_id,
          username: empleado.username,
        },
      });
      if (auditError) throw auditError;

      const { error: passwordError } = await admin.auth.admin.updateUserById(
        targetMembership.user_id,
        { password }
      );
      if (passwordError) throw new Error(passwordError.message);

      const { error: flagError } = await admin
        .from("empleados")
        .update({
          debe_cambiar_password: false,
          actualizado: new Date().toISOString(),
        })
        .eq("id", empleado.id);
      if (flagError) throw flagError;

      return new Response(JSON.stringify({ ok: true, action: "reset_password" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Acción inválida");
  } catch (error) {
    console.error("gestionar-empleado:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Error inesperado",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
