// Fills a test store with fake products and orders, so Runout has
// something to show. Only meant for development stores.
//
// Each product is designed to land in a different status. "finalStock" is what
// should be left after the demo orders; "sold" is units sold over 30 days.
// Shopify subtracts the orders from stock, so each product starts with
// finalStock + sold units.
//
// It's safe to click "Add demo data" more than once: each run only creates
// the products and orders that are still missing. That matters because
// Shopify may refuse some orders (see ORDER_SPACING_MS below), and the next
// click has to be able to finish the job.

import { runQuery } from "./shopify-data.server";

export const DEMO_TAG = "runout-demo";

const DEMO_PRODUCTS = [
  { title: "Cold Brew Coffee Beans (1 kg)", sku: "RUNOUT-BEANS", price: "24.00", finalStock: 12, sold: 60 }, // ~6 days: reorder now
  { title: "Espresso Tamper", sku: "RUNOUT-TAMPER", price: "35.00", finalStock: 5, sold: 30 }, // 5 days: reorder now
  { title: "Pour-Over Kettle", sku: "RUNOUT-KETTLE", price: "59.00", finalStock: 9, sold: 24 }, // ~11 days: reorder soon
  { title: "Paper Coffee Filters (100 pack)", sku: "RUNOUT-FILTERS", price: "8.00", finalStock: 0, sold: 15 }, // out of stock
  { title: "Ceramic Mug", sku: "RUNOUT-MUG", price: "18.00", finalStock: 40, sold: 45 }, // ~27 days: fine
  { title: "Canvas Tote Bag", sku: "RUNOUT-TOTE", price: "22.00", finalStock: 30, sold: 0 }, // no recent sales
];

// The sales are grouped into 5 orders, placed this many days ago.
const ORDER_DAYS_AGO = [27, 21, 14, 8, 2];

// Development stores can create at most 5 orders per minute, which in
// practice means about one every 12 seconds. Space orders out a little more
// than that, and if one is refused anyway, wait and try once more.
const ORDER_SPACING_MS = 13_000;
const RETRY_WAIT_MS = 20_000;

const DEMO_PRODUCTS_QUERY = `#graphql
  query RunoutDemoProducts($query: String!) {
    products(first: 20, query: $query) {
      nodes {
        variants(first: 1) {
          nodes {
            id
            sku
          }
        }
      }
    }
  }`;

const DEMO_ORDERS_QUERY = `#graphql
  query RunoutDemoOrders($query: String!) {
    orders(first: 20, query: $query) {
      nodes {
        id
      }
    }
  }`;

const PRIMARY_LOCATION_QUERY = `#graphql
  query RunoutPrimaryLocation {
    location {
      id
    }
  }`;

const CREATE_PRODUCT_MUTATION = `#graphql
  mutation RunoutCreateDemoProduct($input: ProductSetInput!) {
    productSet(synchronous: true, input: $input) {
      product {
        id
        variants(first: 1) {
          nodes {
            id
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }`;

const CREATE_ORDER_MUTATION = `#graphql
  mutation RunoutCreateDemoOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Splits `total` into `parts` whole numbers, e.g. 24 into 4 -> [6, 6, 6, 6]. */
function splitEvenly(total, parts) {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

function throwIfUserErrors(userErrors, what) {
  if (userErrors?.length) {
    throw new Error(`${what}: ${userErrors.map((error) => error.message).join("; ")}`);
  }
}

/** Creates any demo products that don't exist yet. Returns SKU -> variant ID for all of them. */
async function ensureDemoProducts(admin) {
  const existing = await runQuery(admin, DEMO_PRODUCTS_QUERY, { query: `tag:${DEMO_TAG}` });

  const variantIdBySku = new Map();
  for (const product of existing.products.nodes) {
    const variant = product.variants.nodes[0];
    if (variant?.sku) variantIdBySku.set(variant.sku, variant.id);
  }

  const missing = DEMO_PRODUCTS.filter((product) => !variantIdBySku.has(product.sku));
  if (missing.length === 0) return { variantIdBySku, productsCreated: 0 };

  const { location } = await runQuery(admin, PRIMARY_LOCATION_QUERY);

  for (const product of missing) {
    const data = await runQuery(admin, CREATE_PRODUCT_MUTATION, {
      input: {
        title: product.title,
        status: "ACTIVE",
        tags: [DEMO_TAG],
        productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
        variants: [
          {
            optionValues: [{ optionName: "Title", name: "Default Title" }],
            price: product.price,
            inventoryItem: { tracked: true, sku: product.sku },
            inventoryQuantities: [
              { locationId: location.id, name: "available", quantity: product.finalStock + product.sold },
            ],
          },
        ],
      },
    });
    throwIfUserErrors(data.productSet.userErrors, `Couldn't create "${product.title}"`);
    variantIdBySku.set(product.sku, data.productSet.product.variants.nodes[0].id);
  }

  return { variantIdBySku, productsCreated: missing.length };
}

/** Creates one order. If Shopify refuses it, waits and tries once more. */
async function createOrderWithRetry(admin, variables) {
  for (let attempt = 1; ; attempt++) {
    try {
      const data = await runQuery(admin, CREATE_ORDER_MUTATION, variables);
      throwIfUserErrors(data.orderCreate.userErrors, "Shopify refused a demo order");
      return;
    } catch (error) {
      if (attempt >= 2) throw error;
      await wait(RETRY_WAIT_MS);
    }
  }
}

/**
 * Creates whatever demo products and orders are still missing.
 * Returns what it did, so the page can show a message. Never throws for a
 * refused order: it reports how far it got instead, so the next click can finish.
 */
export async function addDemoData(admin) {
  const { variantIdBySku, productsCreated } = await ensureDemoProducts(admin);

  // Orders are created oldest first and stop at the first failure, so if N
  // demo orders exist, they are the first N. Continue from there.
  const existingOrders = await runQuery(admin, DEMO_ORDERS_QUERY, { query: `tag:${DEMO_TAG}` });
  const firstMissing = Math.min(existingOrders.orders.nodes.length, ORDER_DAYS_AGO.length);
  const ordersNeeded = ORDER_DAYS_AGO.length - firstMissing;

  const quantities = DEMO_PRODUCTS.map((product) => splitEvenly(product.sold, ORDER_DAYS_AGO.length));
  let ordersCreated = 0;

  for (let orderIndex = firstMissing; orderIndex < ORDER_DAYS_AGO.length; orderIndex++) {
    if (ordersCreated > 0) await wait(ORDER_SPACING_MS);

    const lineItems = DEMO_PRODUCTS.map((product, productIndex) => ({
      variantId: variantIdBySku.get(product.sku),
      quantity: quantities[productIndex][orderIndex],
    })).filter((lineItem) => lineItem.quantity > 0);

    try {
      await createOrderWithRetry(admin, {
        order: {
          lineItems,
          financialStatus: "PAID",
          // Backdate the order so it counts as a sale from that many days ago.
          processedAt: new Date(Date.now() - ORDER_DAYS_AGO[orderIndex] * 24 * 60 * 60 * 1000).toISOString(),
          tags: [DEMO_TAG],
          note: "Demo order created by Runout",
        },
        // Subtract the sold units from stock, and don't email anyone.
        options: { inventoryBehaviour: "DECREMENT_IGNORING_POLICY", sendReceipt: false },
      });
      ordersCreated++;
    } catch (error) {
      return { productsCreated, ordersCreated, ordersNeeded, complete: false, error: error.message };
    }
  }

  return { productsCreated, ordersCreated, ordersNeeded, complete: true };
}
