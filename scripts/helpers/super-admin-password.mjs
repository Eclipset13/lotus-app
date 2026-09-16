const ALLOWED_SCHEMAS = new Set(["public", "pg_temp"]);

function qualified(schema, table) {
  if (!ALLOWED_SCHEMAS.has(schema)) throw new Error("Unsupported database schema");
  return `${schema}.${table}`;
}

export async function findActiveSuperAdmin(client, phone, schema = "public") {
  const users = qualified(schema, "users");
  const userRoles = qualified(schema, "user_roles");
  const roles = qualified(schema, "roles");
  const result = await client.query(`
    SELECT u.id::text AS id
    FROM ${users} u
    JOIN ${userRoles} ur ON ur.user_id = u.id
    JOIN ${roles} r ON r.id = ur.role_id
    WHERE u.phone = $1 AND u.status = 'active' AND r.code = 'super_admin'
  `, [phone]);
  return result.rows.length === 1 ? result.rows[0] : null;
}

export async function setExistingSuperAdminPassword(client, { phone, passwordHash, auditSource = "interactive_cli", schema = "public" }) {
  const users = qualified(schema, "users");
  const userRoles = qualified(schema, "user_roles");
  const roles = qualified(schema, "roles");
  const credentials = qualified(schema, "staff_credentials");
  const sessions = qualified(schema, "staff_sessions");
  const audit = qualified(schema, "admin_audit_log");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(726016, 1)");
    const locked = await client.query(`
      SELECT u.id::text AS id
      FROM ${users} u
      JOIN ${userRoles} ur ON ur.user_id = u.id
      JOIN ${roles} r ON r.id = ur.role_id
      WHERE u.phone = $1 AND u.status = 'active' AND r.code = 'super_admin'
      FOR UPDATE OF u
    `, [phone]);
    if (locked.rows.length !== 1) throw new Error("Super administrator is no longer active");
    const userId = locked.rows[0].id;
    await client.query(`
      INSERT INTO ${credentials} (user_id, password_hash, must_change_password)
      VALUES ($1::uuid, $2, false)
      ON CONFLICT (user_id) DO UPDATE
      SET password_hash = $2, must_change_password = false, updated_at = NOW()
    `, [userId, passwordHash]);
    await client.query(`DELETE FROM ${sessions} WHERE user_id = $1::uuid`, [userId]);
    await client.query(`
      INSERT INTO ${audit} (actor_user_id, action, entity_id, details)
      VALUES ($1::uuid, 'staff.password_reset', $1::uuid::text, jsonb_build_object('source', $2::text))
    `, [userId, auditSource]);
    await client.query("COMMIT");
    return { userId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

function cleanMessage(value) {
  const cleaned = String(value ?? "Database operation failed")
    .replace(/scrypt\$[^\s'";]+/gi, "[redacted]")
    .replace(/\b[a-f0-9]{64,}\b/gi, "[redacted]")
    .replace(/'(?:''|[^'])*'/g, "'[redacted]'")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 300);
  return /password|token|secret|salt/i.test(cleaned)
    ? "PostgreSQL rejected the operation; sensitive text was removed."
    : cleaned;
}

function cleanField(value) {
  if (typeof value !== "string" || !/^[\p{L}\p{N}_.-]{1,128}$/u.test(value)) return null;
  return value;
}

export function formatDatabaseError(error) {
  const code = cleanField(error?.code);
  const table = cleanField(error?.table);
  const column = cleanField(error?.column);
  const constraint = cleanField(error?.constraint);
  return [
    "Database operation failed.",
    `code: ${code ?? "not provided"}`,
    `table: ${table ?? "not provided"}`,
    `column: ${column ?? "not provided"}`,
    `constraint: ${constraint ?? "not provided"}`,
    `message: ${cleanMessage(error?.message)}`,
  ].join("\n");
}
