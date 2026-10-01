import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
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

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) throw new Error("Sesión inválida");

    const { data: membership, error: membershipError } = await admin
      .from("negocio_miembros")
      .select("negocio_id, rol, activo")
      .eq("user_id", user.id)
      .eq("activo", true)
      .in("rol", ["owner", "admin"])
      .limit(1)
      .maybeSingle();

    if (membershipError || !membership) {
      throw new Error("No tenés permiso para crear empleados");
    }

    const body = await req.json();
    const nombre = String(body.nombre || "").trim();
    const username = normalize(String(body.username || ""));
    const password = String(body.password || "");
    const rol = String(body.rol || "cashier");

    if (nombre.length < 2) throw new Error("Ingresá el nombre del empleado");
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      throw new Error("El usuario debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo");
    }
    if (password.length < 8) {
      throw new Error("La contraseña temporal debe tener al menos 8 caracteres");
    }
    if (!["admin", "manager", "cashier"].includes(rol)) {
      throw new Error("Rol inválido");
    }

    const { data: negocio, error: negocioError } = await admin
      .from("negocios")
      .select("id, codigo_acceso")
      .eq("id", membership.negocio_id)
      .single();

    if (negocioError || !negocio?.codigo_acceso) {
      throw new Error("El negocio no tiene código de acceso");
    }

    const { data: existingEmployee } = await admin
      .from("empleados")
      .select("id")
      .eq("negocio_id", negocio.id)
      .ilike("username", username)
      .maybeSingle();

    if (existingEmployee) throw new Error("Ese usuario ya existe en tu negocio");

    const code = normalize(negocio.codigo_acceso);
    const internalEmail = `${code}.${username}@employees.vendify.internal`;

    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email: internalEmail,
        password,
        email_confirm: true,
        user_metadata: {
          vendify_employee: true,
          username,
          nombre,
          negocio_id: negocio.id,
        },
      });

    if (createError || !created.user) {
      throw new Error(createError?.message || "No se pudo crear el usuario");
    }

    try {
      const { error: memberError } = await admin
        .from("negocio_miembros")
        .insert({
          negocio_id: negocio.id,
          user_id: created.user.id,
          rol,
          activo: true,
        });

      if (memberError) throw memberError;

      const { error: employeeError } = await admin
        .from("empleados")
        .insert({
          negocio_id: negocio.id,
          user_id: created.user.id,
          username,
          nombre,
          debe_cambiar_password: false,
          activo: true,
        });

      if (employeeError) throw employeeError;

      await admin.from("audit_log").insert({
        negocio_id: negocio.id,
        user_id: user.id,
        accion: "empleado_creado",
        entidad: "empleados",
        entidad_id: created.user.id,
        detalle: { username, nombre, rol },
      });
    } catch (dbError) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw dbError;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        username,
        nombre,
        rol,
        codigo_acceso: negocio.codigo_acceso,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Error inesperado" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      },
    );
  }
});
