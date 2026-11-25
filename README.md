# Runout

A Shopify app that forecasts how many days until each product sells out, and how much to reorder.

![Runout forecast screenshot](docs/screenshot.png)

## Why I built this
I wanted to build something against Shopify's APIs that would be genuinely useful for sellers. Keeping track of inventory is hard, so I built an app that shows each product's status at a glance and tells the seller what to reorder.

## How it works
Runout uses the Shopify Admin GraphQL API to read each product's current stock and its orders from the last 30 days. For each product:

- **Sold per day** = units sold in the last 30 days ÷ 30
- **Days left** = stock ÷ sold per day
- **Suggested reorder** = units needed for the next 30 days − current stock

Products are grouped as Out of stock, Reorder now (under 7 days), Reorder soon (7–14 days) or OK.

## What I learned
I tested the app in a Shopify development store and caught bugs by comparing the real output against what I expected:

- **Gift cards showed as "Out of stock."** Shopify reported my gift card as tracked with 0 in stock, so the app treated it as sold out. Gift cards can't sell out, so the app now marks them "Not tracked."
- **Every product name ended in "- Default Title."** Shopify adds this to products with only one variant, so the app now hides it.
- **The demo data only created 1 of 5 orders.** Shopify limits how fast test stores can take orders, so orders are now spaced out and retried.
- **Order data needed a special permission.** Orders contain customer information, so I requested only the minimum protected data access the app needs.

I also checked the forecast math by hand against the app's output. My biggest lesson was that real data breaks assumptions you didn't know you had, which is why testing matters.

## How I used AI
I built this with Claude Code. I used it to write code and explain Shopify's APIs, and I reviewed its changes, tested the results in my store and verified the math myself.

## Next steps
Right now Runout assumes sales stay the same every month, but products don't sell at the same rate their whole lifetime. Next, I want to make the forecast reflect trends, for example by weighting recent weeks more heavily, so sellers can see whether to stock more or less than last month.

## Running it locally
1. Install Node.js and the Shopify CLI
2. `npm install`
3. `shopify app dev`
