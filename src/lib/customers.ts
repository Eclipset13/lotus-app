import type { Pool, PoolClient } from "pg";
import { normalizePhone } from "./phone";

/** Keep role decisions separate from phone identity; never modify administrator accounts. */
export const nonAdminUserSql = `NOT EXISTS (
  SELECT 1 FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.code IN ('admin', 'super_admin')
)`;

export async function loadCustomerPhoneMap(client: Pool | PoolClient) {
  const result = await client.query<{ id: string; phone: string }>(`
    SELECT u.id, u.phone FROM public.users u WHERE ${nonAdminUserSql}
  `);
  // Normalize legacy values in one place, without rewriting user rows.
  return result.rows.map((user) => ({ id: user.id, phone: normalizePhone(user.phone) }));
}

/** Must run inside the caller's READ COMMITTED transaction, through commit/rollback. */
export async function findOrCreateCustomer(client: PoolClient, name: string, phone: string) {
  const canonical = normalizePhone(phone);
  if (!canonical) throw new Error("Invalid customer phone");

  // Shared across checkout processes. The following SELECT gets
  // a fresh snapshot after a competing checkout commits.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `customer-phone:${canonical}`,
  ]);
  async function findExisting() {
    const users = await client.query<{ id: string; phone: string; is_customer: boolean }>(`
      SELECT u.id, u.phone, ${nonAdminUserSql} AS is_customer
      FROM public.users u ORDER BY u.created_at, u.id
    `);
    const matches = users.rows.filter((user) => normalizePhone(user.phone) === canonical);
    const existing = matches.find((user) => user.is_customer);
    if (existing) return existing.id;
    // A public checkout must not rename an administrator or attach orders to them.
    if (matches.length) throw new CustomerPhoneConflictError();
    return null;
  }

  const existing = await findExisting();
  if (existing) return existing;

  // An external writer may not take our advisory lock. Recover from the phone
  // UNIQUE conflict without leaving the surrounding order transaction aborted.
  await client.query("SAVEPOINT create_customer");
  try {
    const result = await client.query<{ id: string }>(`
      INSERT INTO public.users (name, phone) VALUES ($1, $2) RETURNING id
    `, [name, canonical]);
    await client.query("RELEASE SAVEPOINT create_customer");
    return result.rows[0].id;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT create_customer");
    await client.query("RELEASE SAVEPOINT create_customer");
    if (
      typeof error === "object" && error !== null &&
      "code" in error && error.code === "23505" &&
      "constraint" in error && error.constraint === "users_phone_key"
    ) {
      const winner = await findExisting();
      if (winner) return winner;
    }
    throw error;
  }
}

export class CustomerPhoneConflictError extends Error {}
