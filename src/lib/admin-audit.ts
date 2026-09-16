import "server-only";
import type { PoolClient } from "pg";

export type AuditAction = "staff.create" | "staff.roles" | "staff.disable" | "staff.enable"
  | "staff.password_reset" | "staff.sessions_revoke" | "staff.password_change"
  | "flower.create" | "flower.update" | "flower.activity" | "flower.prices" | "flower.delete"
  | "category.create" | "category.update" | "category.activity" | "category.delete"
  | "inventory.adjust" | "purchase.post" | "delivery.assign"
  | "order.status" | "delivery.status" | "payment.status";
// Call with the mutation's transaction. Never pass request bodies or credentials here.
export async function audit(client: Pick<PoolClient, "query">, actorId: string, action: AuditAction,
  entityId: string, details: Record<string, unknown> = {}) {
  await client.query(`INSERT INTO public.admin_audit_log (actor_user_id, action, entity_id, details)
    VALUES ($1::uuid, $2, $3, $4::jsonb)`, [actorId, action, entityId, JSON.stringify(details)]);
}
