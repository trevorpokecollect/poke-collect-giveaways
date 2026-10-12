import type { Campaign } from "@prisma/client";
import { unauthenticated } from "../../shopify.server";
import { estimateEntries } from "../entries/estimate";
import { purchaseRulesSchema } from "../entries/rules";
import { parseSettings } from "../settings";
import { purchaseRateText } from "../shop-promo";

// The widget's "Shop & earn" box: the purchase-entry rate, a Shop now link, and the
// example products the merchant picked, with live prices and the entries each one earns.

export interface ShopItem {
  title: string;
  url: string;
  imageUrl: string | null;
  price: number;
  entries: number;
}

interface Product {
  id: string;
  title: string;
  handle: string;
  status: string;
  imageUrl: string | null;
  variantId: string | null;
  price: number;
}

const TTL_MS = 10 * 60 * 1000;
// Product lookups per shop and product list, so popup views don't each call the Admin API.
const cache = new Map<string, { at: number; products: Product[] }>();

const QUERY = `#graphql
  query ShopPromoProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        status
        featuredMedia { preview { image { url(transform: { maxWidth: 400 }) } } }
        variants(first: 1, sortKey: POSITION) { nodes { id price } }
      }
    }
  }`;

async function loadProducts(shop: string, ids: string[]) {
  const key = `${shop}|${ids.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.products;
  const { admin } = await unauthenticated.admin(shop);
  const res = await admin.graphql(QUERY, { variables: { ids } });
  const body = (await res.json()) as {
    data?: { nodes: (Record<string, unknown> | null)[] };
  };
  const products = (body.data?.nodes ?? []).flatMap((n): Product[] => {
    if (!n || typeof n.id !== "string") return [];
    const node = n as {
      id: string;
      title: string;
      handle: string;
      status: string;
      featuredMedia?: { preview?: { image?: { url?: string } } } | null;
      variants: { nodes: { id: string; price: string }[] };
    };
    const v = node.variants.nodes[0];
    return [
      {
        id: node.id,
        title: node.title,
        handle: node.handle,
        status: node.status,
        imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
        variantId: v?.id ?? null,
        price: v ? Number(v.price) : 0,
      },
    ];
  });
  cache.set(key, { at: Date.now(), products });
  return products;
}

export async function shopPromo(campaign: Campaign) {
  const cfg = parseSettings(campaign.settings).shop;
  if (!cfg.enabled) return null;
  const parsed = purchaseRulesSchema.safeParse(campaign.purchaseRules ?? undefined);
  if (!campaign.purchaseRules || !parsed.success || !parsed.data.enabled) return null;
  const rules = parsed.data;
  const rate = purchaseRateText(rules);
  if (!rate) return null;

  let items: ShopItem[] = [];
  const ids = cfg.products.map((p) => p.id);
  if (ids.length) {
    try {
      items = (await loadProducts(campaign.shop, ids))
        .filter((p) => p.status === "ACTIVE")
        .map((p) => ({
          title: p.title,
          url: `/products/${p.handle}`,
          imageUrl: p.imageUrl,
          price: p.price,
          entries: estimateEntries(rules, [
            {
              productId: p.id,
              variantId: p.variantId,
              quantity: 1,
              price: Math.round(p.price * 100),
            },
          ]),
        }));
    } catch (e) {
      // The rate and Shop now link still show without the examples.
      console.error("shop promo products", e);
    }
  }
  return { rate, url: cfg.url || "/collections/all", items };
}
