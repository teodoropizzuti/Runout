// Fills a test store with fake products and orders, so Runout has
// something to show. Only meant for development stores.
//
// Each product is designed to land in a different status. "finalStock" is what
// should be left after the demo orders; "sold" is units sold over 30 days.
// Shopify subtracts the orders from stock, so each product starts with
// finalStock + sold units.

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

// Development stores can only create 5 orders per minute, so the sales are
// grouped into 5 orders, placed this many days ago.
const ORDER_DAYS_AGO = [27, 21, 14, 8, 2];

const EXISTING_DEMO_QUERY = `#graphql
  query RunoutDemoExists($query: String!) {
    products(first: 1, query: $query) {
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

/**
 * Creates the demo products and orders.
 * Returns { created: false } without changing anything if they already exist.
 */
export async function addDemoData(admin) {
  const existing = await runQuery(admin, EXISTING_DEMO_QUERY, { query: `tag:${DEMO_TAG}` });
  if (existing.products.nodes.length > 0) {
    return { created: false };
  }

  const { location } = await runQuery(admin, PRIMARY_LOCATION_QUERY);

  // 1. Create the products with their starting stock.
  const variantIds = [];
  for (const product of DEMO_PRODUCTS) {
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
    variantIds.push(data.productSet.product.variants.nodes[0].id);
  }

  // 2. Create the orders, spreading each product's sales across them.
  const quantities = DEMO_PRODUCTS.map((product) => splitEvenly(product.sold, ORDER_DAYS_AGO.length));

  for (const [orderIndex, daysAgo] of ORDER_DAYS_AGO.entries()) {
    const lineItems = DEMO_PRODUCTS.map((_, productIndex) => ({
      variantId: variantIds[productIndex],
      quantity: quantities[productIndex][orderIndex],
    })).filter((lineItem) => lineItem.quantity > 0);

    const data = await runQuery(admin, CREATE_ORDER_MUTATION, {
      order: {
        lineItems,
        financialStatus: "PAID",
        // Backdate the order so it counts as a sale from `daysAgo` days ago.
        processedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
        tags: [DEMO_TAG],
        note: "Demo order created by Runout",
      },
      // Subtract the sold units from stock, and don't email anyone.
      options: { inventoryBehaviour: "DECREMENT_IGNORING_POLICY", sendReceipt: false },
    });
    throwIfUserErrors(data.orderCreate.userErrors, "Couldn't create a demo order");
  }

  return { created: true, products: DEMO_PRODUCTS.length, orders: ORDER_DAYS_AGO.length };
}
