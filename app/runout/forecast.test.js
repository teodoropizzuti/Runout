// Tests for the forecast maths in forecast.js.
// Run them with: npm test
//
// Each test runs the real code with made-up numbers and checks the answer.
// `assert.equal(actual, expected)` fails the test if the two don't match.

import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastVariant, buildForecasts, summarize } from "./forecast.js";

// ---- One product at a time ----

test("coffee beans: 12 in stock, 60 sold in 30 days -> reorder now, 6 days left", () => {
  const result = forecastVariant({ inStock: 12, unitsSold: 60 });

  assert.equal(result.dailyRate, 2); // 60 / 30 = 2 a day
  assert.equal(result.daysLeft, 6); // 12 / 2 = 6 days
  assert.equal(result.status, "urgent"); // under 7 days
  assert.equal(result.reorderQuantity, 48); // need 60 for the next 30 days, have 12
});

test("kettle: about 11 days left -> reorder soon", () => {
  const result = forecastVariant({ inStock: 9, unitsSold: 24 });

  // 9 / 0.8 = 11.25. Computers store decimals slightly imprecisely, so check
  // that it's very close rather than exactly equal.
  assert.ok(Math.abs(result.daysLeft - 11.25) < 0.0001);
  assert.equal(result.status, "soon");
});

test("mug: plenty of stock -> OK", () => {
  const result = forecastVariant({ inStock: 40, unitsSold: 45 });

  assert.equal(result.status, "ok");
});

test("0 units in stock -> out of stock, even if it sold well", () => {
  const result = forecastVariant({ inStock: 0, unitsSold: 15 });

  assert.equal(result.status, "out");
  assert.equal(result.daysLeft, 0);
  assert.equal(result.reorderQuantity, 15); // enough for the next 30 days
});

test("negative stock (oversold) counts as out of stock", () => {
  const result = forecastVariant({ inStock: -3, unitsSold: 10 });

  assert.equal(result.status, "out");
});

test("nothing sold recently -> no recent sales, no forecast, no reorder", () => {
  const result = forecastVariant({ inStock: 30, unitsSold: 0 });

  assert.equal(result.status, "no-sales");
  assert.equal(result.daysLeft, null); // can't divide by a rate of 0
  assert.equal(result.reorderQuantity, 0);
});

test("not tracked -> 'not-tracked', never 'out of stock', even with sales", () => {
  // e.g. a gift card: it sells, but Shopify has no stock count for it.
  const result = forecastVariant({ inStock: null, unitsSold: 20, tracked: false });

  assert.equal(result.status, "not-tracked");
  assert.equal(result.daysLeft, null);
  assert.equal(result.reorderQuantity, 0);
});

// ---- The edges between statuses ----
// "Under 7 days" is urgent, so exactly 7 should NOT be urgent.

test("exactly 7 days left -> reorder soon, not reorder now", () => {
  const result = forecastVariant({ inStock: 7, unitsSold: 30 }); // 1 a day

  assert.equal(result.daysLeft, 7);
  assert.equal(result.status, "soon");
});

test("exactly 14 days left -> OK, not reorder soon", () => {
  const result = forecastVariant({ inStock: 14, unitsSold: 30 }); // 1 a day

  assert.equal(result.daysLeft, 14);
  assert.equal(result.status, "ok");
});

test("a different window length changes the daily rate", () => {
  // 14 sold over 7 days is 2 a day, so 10 in stock lasts 5 days.
  const result = forecastVariant({ inStock: 10, unitsSold: 14, windowDays: 7 });

  assert.equal(result.dailyRate, 2);
  assert.equal(result.daysLeft, 5);
});

// ---- The whole list ----

// The six demo products: id, units in stock, units sold in 30 days.
const DEMO = [
  { id: "beans", inStock: 12, sold: 60 },
  { id: "tamper", inStock: 5, sold: 30 },
  { id: "kettle", inStock: 9, sold: 24 },
  { id: "filters", inStock: 0, sold: 15 },
  { id: "mug", inStock: 40, sold: 45 },
  { id: "tote", inStock: 30, sold: 0 },
];

function demoForecasts() {
  const variants = DEMO.map(({ id, inStock }) => ({ id, inStock }));
  const unitsSold = new Map(DEMO.map(({ id, sold }) => [id, sold]));
  return buildForecasts(variants, unitsSold);
}

test("the list is sorted most urgent first", () => {
  const order = demoForecasts().map((row) => row.id);

  // Out of stock, then reorder now (5 days before 6), soon, OK, no sales.
  assert.deepEqual(order, ["filters", "tamper", "beans", "kettle", "mug", "tote"]);
});

test("untracked products go to the bottom of the list, below no recent sales", () => {
  const variants = [
    { id: "gift-card", inStock: null, tracked: false },
    { id: "tote", inStock: 30, tracked: true },
    { id: "filters", inStock: 0, tracked: true },
  ];
  const unitsSold = new Map([["gift-card", 12], ["filters", 15]]);

  const order = buildForecasts(variants, unitsSold).map((row) => row.id);
  assert.deepEqual(order, ["filters", "tote", "gift-card"]);
});

test("a product with no orders at all counts as 0 sold", () => {
  const rows = buildForecasts([{ id: "new-product", inStock: 8 }], new Map());

  assert.equal(rows[0].unitsSold, 0);
  assert.equal(rows[0].status, "no-sales");
});

test("the summary counts how many products are in each status", () => {
  const counts = summarize(demoForecasts());

  // assert.deepEqual compares objects field by field.
  assert.deepEqual(counts, { out: 1, urgent: 2, soon: 1, ok: 1, "no-sales": 1, "not-tracked": 0 });
});
