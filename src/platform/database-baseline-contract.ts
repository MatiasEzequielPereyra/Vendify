export interface DatabaseBaselineWorkspace {
  readonly manifest: unknown;
  readonly assembly: unknown;
  readonly capture: unknown;
  readonly dependencyCapture: unknown;
  readonly transitiveCapture: unknown;
  readonly files: Readonly<Record<string, string | undefined>>;
}

export interface DatabaseBaselineValidation {
  readonly errors: readonly string[];
  readonly relationCount: number;
  readonly missingDefinitions: readonly string[];
  readonly executableBaseline: string | null;
  readonly status: string | null;
  readonly missingExecutableDependencies: readonly string[];
}

export interface DatabaseBaselineGeneration {
  readonly content: string | null;
  readonly errors: readonly string[];
  readonly stepCount: number;
  readonly transactionCount: number;
}

type JsonObject = Readonly<Record<string, unknown>>;

const TRIGGER_FUNCTIONS = [
  "public.crear_stock_sucursales_producto_v1()",
  "public.stock_sucursal_recalcular_total_trigger_v1()",
  "public.validar_autorizacion_descuento_venta_v1()"
] as const;
const CORE_RELATIONS = ["categorias", "productos", "movimientos", "ventas", "venta_items"] as const;
const STOCK_MARKERS = [
  "producto_stock_sucursal",
  "recalcular_stock_total_producto_v1",
  "stock_sucursal_recalcular_total_trigger_v1",
  "crear_stock_sucursales_producto_v1"
] as const;

function object(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function texts(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? [...value]
    : null;
}

function objects(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(object).filter((entry): entry is JsonObject => entry !== null)
    : [];
}

function file(workspace: DatabaseBaselineWorkspace, path: string | null): string | null {
  return path ? workspace.files[path] ?? null : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateDatabaseBaseline(
  workspace: DatabaseBaselineWorkspace
): DatabaseBaselineValidation {
  const errors: string[] = [];
  const fail = (message: string): void => { errors.push(message); };
  const manifest = object(workspace.manifest);
  const assembly = object(workspace.assembly);
  const capture = object(workspace.capture);
  const dependencyCapture = object(workspace.dependencyCapture);
  const transitiveCapture = object(workspace.transitiveCapture);

  if (manifest?.schemaVersion !== 1) fail("unsupported database baseline schema");
  const requiredRelations = objects(manifest?.requiredRelations);
  if (requiredRelations.length === 0) fail("database baseline has no required relations");

  const capturedRelations = new Map<string, JsonObject>();
  for (const relation of objects(capture?.relations)) {
    const name = text(relation.name);
    if (name) capturedRelations.set(name, relation);
  }
  const names = new Set<string>();
  const derivedMissing: string[] = [];
  for (const relation of requiredRelations) {
    const name = text(relation.name);
    if (!name || names.has(name)) {
      fail(`invalid or duplicate relation: ${name ?? "missing"}`);
      if (!name) continue;
    }
    names.add(name);
    const sources = texts(relation.definitionSources);
    if (!sources) {
      fail(`relation ${name} has invalid sources`);
      continue;
    }
    if (sources.length === 0) derivedMissing.push(name);
    for (const source of sources) {
      const sourceContent = file(workspace, source);
      if (sourceContent === null) {
        fail(`relation ${name} references missing source: ${source}`);
      } else if (source.endsWith(".json")) {
        const captured = capturedRelations.get(name);
        if (!captured || !Array.isArray(captured.columns) || captured.columns.length === 0) {
          fail(`capture has no structural definition for public.${name}`);
        }
      } else if (!new RegExp(
        `create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\.${escapeRegExp(name)}\\b`, "i"
      ).test(sourceContent)) {
        fail(`source does not create public.${name}: ${source}`);
      }
    }
  }

  const declaredMissing = texts(manifest?.missingAuthoritativeDefinitions)?.sort() ?? [];
  if (JSON.stringify(derivedMissing.sort()) !== JSON.stringify(declaredMissing)) {
    fail("missing baseline definitions are stale");
  }
  const status = text(manifest?.status);
  const executableBaseline = text(manifest?.executableBaseline);
  if (declaredMissing.length > 0 && status !== "incomplete") {
    fail("baseline with missing definitions must remain incomplete");
  }
  if (declaredMissing.length === 0 && !executableBaseline && status !== "captured_core_relations") {
    fail("captured source inventory must remain in assembly state");
  }
  if (executableBaseline && !["ready_for_disposable_test", "validated_local_disposable"].includes(status ?? "")) {
    fail("an executable baseline must advance to disposable testing");
  }
  if (executableBaseline && file(workspace, executableBaseline) === null) {
    fail("executable baseline file is missing");
  }
  if (status === "validated_local_disposable") {
    const localValidation = object(manifest?.localValidation);
    if (
      !text(localValidation?.observedAt) ||
      localValidation?.resetResult !== "pass" ||
      localValidation.validationResult !== "ok" ||
      localValidation.schemaLintResult !== "no_errors"
    ) {
      fail("validated local baseline lacks complete local validation evidence");
    }
  }

  const validationDiagnostic = text(manifest?.validationDiagnostic);
  if (!validationDiagnostic || file(workspace, validationDiagnostic) === null) {
    fail("baseline validation diagnostic is missing");
  }
  if (!text(manifest?.allowedRecoveryMethod) || !Array.isArray(manifest?.forbiddenShortcuts)) {
    fail("baseline recovery safety policy is incomplete");
  }
  for (const [property, message] of [
    ["captureDiagnostic", "baseline capture diagnostic is missing"],
    ["dependencyCaptureDiagnostic", "baseline dependency capture diagnostic is missing"],
    ["transitiveDependencyCaptureDiagnostic", "baseline transitive dependency diagnostic is missing"]
  ] as const) {
    const path = text(manifest?.[property]);
    if (!path || file(workspace, path) === null) fail(message);
  }

  if (!transitiveCapture) {
    fail("baseline transitive dependency evidence is missing");
  } else {
    if (transitiveCapture.capture_version !== 1) fail("unsupported transitive dependency capture version");
    if (Array.isArray(transitiveCapture.missing_functions) && transitiveCapture.missing_functions.length !== 0) {
      fail("transitive dependency capture still reports missing functions");
    }
    const helper = objects(transitiveCapture.functions).find(
      (candidate) => candidate.identity === "public.recalcular_stock_total_producto_v1(uuid)"
    );
    const definition = text(helper?.definition);
    if (!definition) {
      fail("transitive dependency evidence is missing the stock-total helper definition");
    } else {
      if (!/security definer/i.test(definition) || !/set search_path to 'public'/i.test(definition)) {
        fail("captured stock-total helper lacks its security contract");
      }
      if (!/sum\(ps\.stock\)/i.test(definition) || !/where ps\.producto_id = p_producto_id/i.test(definition)) {
        fail("captured stock-total helper lacks its aggregate invariant");
      }
    }
  }

  if (!dependencyCapture) {
    fail("baseline trigger-function evidence is missing");
  } else {
    if (dependencyCapture.capture_version !== 1) fail("unsupported trigger-function capture version");
    const capturedFunctions = new Set(objects(dependencyCapture.functions).map(
      (candidate) => `${String(candidate.schema)}.${String(candidate.name)}(${String(candidate.identity_arguments)})`
    ));
    for (const expected of TRIGGER_FUNCTIONS) {
      if (!capturedFunctions.has(expected)) fail(`trigger-function evidence is missing ${expected}`);
    }
  }

  const missingExecutableDependencies = texts(manifest?.missingExecutableDependencies);
  if (!missingExecutableDependencies) fail("baseline executable dependency inventory is missing");
  if (!assembly) {
    fail("baseline assembly draft is missing");
  } else {
    const assemblyStatus = text(assembly.status);
    if (
      !["assembling", "ready_for_disposable_test", "validated_local_disposable"].includes(assemblyStatus ?? "") ||
      assembly.target !== "empty_disposable_supabase_project"
    ) fail("baseline assembly draft has an unsafe status or target");
    if (status && assemblyStatus && status !== assemblyStatus) {
      fail("baseline manifest and assembly statuses disagree");
    }
    const validation = object(assembly.validation);
    if (
      validation?.static !== "pass" ||
       !["pending", "pass"].includes(text(validation.disposableProject) ?? "")
    ) {
      fail("baseline assembly validation evidence is invalid");
    }
    const steps = texts(assembly.steps);
    if (!steps || steps.length === 0) {
      fail("baseline assembly has no ordered steps");
    } else {
      for (const step of steps) {
        if (file(workspace, step) === null) fail(`baseline assembly references missing step: ${step}`);
      }
      if (steps[0] !== "supabase/baseline/000_v1_core.sql") {
        fail("baseline assembly must start with the v1 core");
      }
      const multiTenant = steps.indexOf("supabase/legacy/001_multiempresa_roles_sucursales_FIX.sql");
      const branchStock = steps.indexOf("supabase/baseline/010_v226_branch_stock.sql");
      if (multiTenant < 0 || branchStock <= multiTenant) {
        fail("branch stock must be assembled after multi-tenant foundations");
      }
    }

    const coreSql = file(workspace, "supabase/baseline/000_v1_core.sql") ?? "";
    for (const relation of CORE_RELATIONS) {
      if (!new RegExp(`create\\s+table\\s+public\\.${relation}\\b`, "i").test(coreSql)) {
        fail(`v1 core does not create public.${relation}`);
      }
    }
    const stockSql = file(workspace, "supabase/baseline/010_v226_branch_stock.sql") ?? "";
    for (const marker of STOCK_MARKERS) {
      if (!stockSql.includes(marker)) fail(`branch-stock foundation lacks ${marker}`);
    }
    const validationSql = file(workspace, validationDiagnostic) ?? "";
    if (!/vendify_pre_v231_baseline_validation/i.test(validationSql) || !/'ok'/i.test(validationSql)) {
      fail("baseline validation diagnostic lacks its result contract");
    }
    const statements = validationSql.replace(/^\s*--.*$/gm, "");
    if (/^\s*(?:insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/im.test(statements)) {
      fail("baseline validation diagnostic must remain read-only");
    }
  }

  if (!capture) {
    fail("baseline capture evidence is missing");
  } else {
    if (capture.capture_version !== 1) fail("unsupported baseline capture version");
    if (Array.isArray(capture.missing_relations) && capture.missing_relations.length !== 0) {
      fail("baseline capture reports missing relations");
    }
    const expected = [...names].filter((name) => capturedRelations.has(name)).sort();
    const actual = [...capturedRelations.keys()].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      fail("baseline capture relation inventory is unexpected");
    }
  }

  return Object.freeze({
    errors: Object.freeze(errors),
    relationCount: names.size,
    missingDefinitions: Object.freeze(declaredMissing),
    executableBaseline,
    status,
    missingExecutableDependencies: Object.freeze(missingExecutableDependencies ?? [])
  });
}

export function generateDatabaseBaseline(input: {
  readonly assembly: unknown;
  readonly sourceSql: Readonly<Record<string, string | undefined>>;
}): DatabaseBaselineGeneration {
  const assembly = object(input.assembly);
  const steps = texts(assembly?.steps);
  if (!steps || steps.length === 0) {
    return Object.freeze({ content: null, errors: ["Baseline assembly has no ordered steps"], stepCount: 0, transactionCount: 0 });
  }
  const errors: string[] = [];
  const sections: string[] = [];
  for (const [index, path] of steps.entries()) {
    const sql = input.sourceSql[path];
    if (sql === undefined) {
      errors.push(`Missing baseline step: ${path}`);
      continue;
    }
    sections.push([
      "-- ============================================================================",
      `-- STEP ${String(index + 1).padStart(2, "0")}: ${path}`,
      "-- ============================================================================",
      sql.replace(/\r\n/g, "\n").trimEnd()
    ].join("\n"));
  }
  if (errors.length > 0) {
    return Object.freeze({ content: null, errors: Object.freeze(errors), stepCount: steps.length, transactionCount: 0 });
  }
  const generated = [
    "-- GENERATED FILE. DO NOT EDIT.",
    "-- Vendify pre-v2.31 clean bootstrap candidate.",
    "-- Target: empty disposable Supabase project only until live validation passes.",
    "-- Source order: supabase/baseline/assembly.json",
    "",
    ...sections,
    ""
  ].join("\n\n");
  const begins = generated.match(/^\s*begin;\s*$/gim)?.length ?? 0;
  const commits = generated.match(/^\s*commit;\s*$/gim)?.length ?? 0;
  if (begins !== commits) errors.push(
    `Unbalanced baseline transactions: ${String(begins)} BEGIN / ${String(commits)} COMMIT`
  );
  if (/^\s*drop\s+(?:table|schema)\b/im.test(generated)) {
    errors.push("Destructive DROP TABLE/SCHEMA is forbidden in the clean bootstrap package");
  }
  if (/service_role|SUPABASE_SERVICE/i.test(generated)) {
    errors.push("Privileged service credentials or roles are forbidden in the bootstrap package");
  }
  return Object.freeze({
    content: errors.length === 0 ? generated : null,
    errors: Object.freeze(errors),
    stepCount: steps.length,
    transactionCount: begins
  });
}
