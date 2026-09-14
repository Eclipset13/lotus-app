import { loadPublicBouquets } from "@/lib/public-bouquets";
import Storefront from "@/components/storefront";

export const dynamic = "force-dynamic";

export default async function Home() {
  const bouquets = await loadPublicBouquets();
  return <Storefront bouquets={bouquets} />;
}
