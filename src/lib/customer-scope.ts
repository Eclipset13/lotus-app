// $1 is the phone map produced by loadCustomerPhoneMap using normalizePhone.
export const customerScopeSql = `
  phone_map AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS m(id uuid, phone text)
  ),
  eligible_customers AS (
    SELECT u.id, u.name, COALESCE(m.phone, u.phone) AS phone, u.created_at,
           COALESCE(m.phone, u.id::text) AS identity_key
    FROM public.users u
    JOIN phone_map m ON m.id = u.id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.user_roles admin_user_role
      JOIN public.roles admin_role ON admin_role.id = admin_user_role.role_id
      WHERE admin_user_role.user_id = u.id
        AND admin_role.code IN ('admin', 'super_admin')
    )
      AND (
        EXISTS (
          SELECT 1
          FROM public.user_roles customer_user_role
          JOIN public.roles customer_role ON customer_role.id = customer_user_role.role_id
          WHERE customer_user_role.user_id = u.id
            AND customer_role.code = 'customer'
        )
        OR EXISTS (
          SELECT 1
          FROM public.orders customer_order
          WHERE customer_order.customer_id = u.id
        )
      )
  ),
  customer_members AS (
    SELECT *, first_value(id) OVER (
      PARTITION BY identity_key ORDER BY created_at, id
    ) AS customer_id
    FROM eligible_customers
  ),
  customer_scope AS (
    SELECT representative.id, representative.name, representative.phone, representative.created_at,
           array_agg(member.id) AS member_ids,
           string_agg(member.name, ' ') AS search_names
    FROM customer_members representative
    JOIN customer_members member ON member.customer_id = representative.id
    WHERE representative.id = representative.customer_id
    GROUP BY representative.id, representative.name, representative.phone, representative.created_at
  ),
  order_aggregates AS (
    SELECT member.customer_id,
           count(*) FILTER (WHERE o.status <> 'cancelled')::int AS order_count,
           count(*) FILTER (WHERE o.status = 'completed')::int AS completed_order_count,
           max(o.created_at) FILTER (WHERE o.status <> 'cancelled') AS last_order_at
    FROM public.orders o
    JOIN customer_members member ON member.id = o.customer_id
    GROUP BY member.customer_id
  ),
  payment_aggregates AS (
    SELECT member.customer_id,
           COALESCE(sum(p.amount), 0)::text AS paid_total
    FROM public.orders o
    JOIN customer_members member ON member.id = o.customer_id
    JOIN public.payments p ON p.order_id = o.id
    WHERE o.status <> 'cancelled'
      AND p.status = 'paid'
    GROUP BY member.customer_id
  )
`;
