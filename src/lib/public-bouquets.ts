import "server-only";
import { db } from "@/lib/db";

export type PublicBouquet = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  sale_price: string;
  is_featured: boolean;
};

export async function loadPublicBouquets(): Promise<PublicBouquet[]> {
  const result = await db.query<PublicBouquet>(`
    SELECT id::text, name, description, image_url,
           sale_price::text, is_featured
    FROM public.bouquets
    WHERE is_active = true
    ORDER BY is_featured DESC, name, id
  `);
  return result.rows;
}
