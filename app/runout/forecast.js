// The core idea of Runout, with no Shopify code in it:
// "If this product keeps selling as fast as it did recently,
//  how many days until it runs out?"
//
//   daily sales rate = units sold in the window / days in the window
//   days left        = units in stock / daily sales rate

// How far back we look at sales.
export const WINDOW_DAYS = 30;

// Fewer than this many days of stock left means "reorder now".
export const URGENT_DAYS = 7;

// Fewer than this many days left means "reorder soon".
export const SOON_DAYS = 14;

// Statuses from most to least urgent. Used to sort the table.
export const STATUS_ORDER = ["out", "urgent", "soon", "ok", "no-sales"];

/**
 * Works out the forecast for one product variant.
 *
 * @param {object} input
 * @param {number} input.inStock   Units available right now.
 * @param {number} input.unitsSold Units sold in the last WINDOW_DAYS days.
 * @param {number} [input.windowDays]
 * @returns {{ status: string, dailyRate: number, daysLeft: number | null, reorderQuantity: number }}
 */
export function forecastVariant({ inStock, unitsSold, windowDays = WINDOW_DAYS }) {
  const dailyRate = unitsSold / windowDays;

  // How many to order so there's enough for the next window (e.g. 30 days).
  const reorderQuantity = Math.max(0, Math.ceil(dailyRate * windowDays - inStock));

  if (inStock <= 0) {
    return { status: "out", dailyRate, daysLeft: 0, reorderQuantity };
  }

  // Nothing sold recently: we can't predict a sell-out date.
  if (dailyRate === 0) {
    return { status: "no-sales", dailyRate, daysLeft: null, reorderQuantity: 0 };
  }

  const daysLeft = inStock / dailyRate;

  let status = "ok";
  if (daysLeft < URGENT_DAYS) status = "urgent";
  else if (daysLeft < SOON_DAYS) status = "soon";

  return { status, dailyRate, daysLeft, reorderQuantity };
}

/**
 * Combines stock levels and sales into one sorted list of forecasts.
 *
 * @param {Array<{ id: string, inStock: number }>} variants
 * @param {Map<string, number>} unitsSoldByVariant Variant ID -> units sold.
 */
export function buildForecasts(variants, unitsSoldByVariant, windowDays = WINDOW_DAYS) {
  const rows = variants.map((variant) => {
    const unitsSold = unitsSoldByVariant.get(variant.id) ?? 0;
    return {
      ...variant,
      unitsSold,
      ...forecastVariant({ inStock: variant.inStock, unitsSold, windowDays }),
    };
  });

  // Most urgent first; within the same status, fewest days left first.
  rows.sort((a, b) => {
    const byStatus = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (byStatus !== 0) return byStatus;
    return (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity);
  });

  return rows;
}

/** Counts how many products are in each status, for the summary cards. */
export function summarize(rows) {
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  for (const row of rows) counts[row.status] += 1;
  return counts;
}
