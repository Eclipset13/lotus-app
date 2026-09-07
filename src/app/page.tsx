import { db } from "@/lib/db";
import Storefront, {
  type Bouquet,
} from "@/components/storefront";

export const dynamic = "force-dynamic";

export default async function Home() {
  const result = await db.query<Bouquet>(`
    SELECT
      id,
      name,
      slug,
      description,
      sale_price,
      is_featured
    FROM bouquets
    ORDER BY is_featured DESC, name
  `);

  return <Storefront bouquets={result.rows} />;
}