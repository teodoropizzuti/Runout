// Gets the data Runout needs from Shopify's Admin GraphQL API:
//   1. every product variant whose stock Shopify tracks, with its stock level
//   2. every order from the last WINDOW_DAYS days, to count units sold
// (".server.js" means this file only ever runs on the server, never in the browser.)

import { buildForecasts, summarize, WINDOW_DAYS } from "./forecast";

const VARIANTS_QUERY = `#graphql
  query RunoutVariants($after: String) {
    productVariants(first: 100, after: $after) {
      nodes {
        id
        title
        displayName
        sku
        inventoryQuantity
        inventoryItem {
          tracked
        }
        product {
          id
          title
          status
          isGiftCard
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`;

const ORDERS_QUERY = `#graphql
  query RunoutOrders($after: String, $query: String!) {
    orders(first: 25, after: $after, query: $query) {
      nodes {
        cancelledAt
        lineItems(first: 30) {
          nodes {
            currentQuantity
            variant {
              id
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`;

// Shopify returns results in pages. Stop after this many pages so a huge
// store can't make the page hang (25 orders x 40 pages = 1,000 orders).
const MAX_PAGES = 40;

/** Runs a GraphQL query and throws a readable error if Shopify reports one. */
export async function runQuery(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  return json.data;
}

/** Fetches every page of a list. `field` is the list's name, e.g. "orders". */
async function fetchAllPages(admin, query, field, variables = {}) {
  const items = [];
  let after = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await runQuery(admin, query, { ...variables, after });
    const { nodes, pageInfo } = data[field];
    items.push(...nodes);
    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  return items;
}

/**
 * Stock levels for every variant that isn't archived.
 * Untracked variants are kept (and marked) so owners can see why they have no forecast.
 */
async function fetchVariants(admin) {
  const variants = await fetchAllPages(admin, VARIANTS_QUERY, "productVariants");

  return variants
    .filter((variant) => variant.product.status !== "ARCHIVED")
    .map((variant) => {
      // Tracked means Shopify counts its stock AND it can actually sell out.
      // A gift card never sells out, even if "Track quantity" was switched on
      // for it by mistake. A missing stock number means "unknown", not 0.
      const tracked =
        Boolean(variant.inventoryItem?.tracked) &&
        !variant.product.isGiftCard &&
        typeof variant.inventoryQuantity === "number";

      return {
        id: variant.id,
        // Products with only one version have a hidden version called
        // "Default Title". Show just the product name for those.
        name: variant.title === "Default Title" ? variant.product.title : variant.displayName,
        sku: variant.sku,
        productId: variant.product.id,
        tracked,
        // null means "no stock count", which is different from 0 in stock.
        inStock: tracked ? variant.inventoryQuantity : null,
      };
    });
}

/** Units sold per variant over the last `windowDays` days. */
async function fetchUnitsSold(admin, windowDays) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const orders = await fetchAllPages(admin, ORDERS_QUERY, "orders", {
    query: `processed_at:>='${since.toISOString()}'`,
  });

  const unitsSold = new Map();
  for (const order of orders) {
    if (order.cancelledAt) continue; // Cancelled orders don't count as sales.

    for (const lineItem of order.lineItems.nodes) {
      // variant is empty if the product was deleted after the sale.
      const variantId = lineItem.variant?.id;
      if (!variantId) continue;
      unitsSold.set(variantId, (unitsSold.get(variantId) ?? 0) + lineItem.currentQuantity);
    }
  }

  return unitsSold;
}

/** Everything the Runout page shows: the forecast table and summary counts. */
export async function getRunoutReport(admin, windowDays = WINDOW_DAYS) {
  const [variants, unitsSold] = await Promise.all([
    fetchVariants(admin),
    fetchUnitsSold(admin, windowDays),
  ]);

  const rows = buildForecasts(variants, unitsSold, windowDays);
  return { rows, summary: summarize(rows), windowDays };
}
