import { WINDOW_DAYS, URGENT_DAYS, SOON_DAYS } from "../runout/forecast";

export default function HowItWorks() {
  return (
    <s-page heading="How the forecast works">
      <s-section heading="The idea">
        <s-paragraph>
          Most low-stock alerts tell you when a product drops below a fixed
          number, like 5 units. But 5 units of something that sells 10 a day is
          an emergency, and 5 units of something that sells once a month is
          fine. Runout looks at how fast each product actually sells.
        </s-paragraph>
      </s-section>

      <s-section heading="The calculation">
        <s-ordered-list>
          <s-list-item>
            Add up the units sold in the last {WINDOW_DAYS} days, from every
            order that wasn&apos;t cancelled. Refunded units don&apos;t count.
          </s-list-item>
          <s-list-item>
            Daily sales rate = units sold ÷ {WINDOW_DAYS}.
          </s-list-item>
          <s-list-item>
            Days left = units in stock ÷ daily sales rate.
          </s-list-item>
          <s-list-item>
            Suggested reorder = enough units to cover the next {WINDOW_DAYS}{" "}
            days at the same rate, minus what&apos;s already in stock.
          </s-list-item>
        </s-ordered-list>
        <s-paragraph>
          Example: 12 bags of coffee in stock, 60 sold in the last 30 days. That
          is 2 a day, so the stock lasts about 6 days.
        </s-paragraph>
      </s-section>

      <s-section heading="Statuses">
        <s-unordered-list>
          <s-list-item>
            <s-badge tone="critical">Out of stock</s-badge> No units available.
          </s-list-item>
          <s-list-item>
            <s-badge tone="warning">Reorder now</s-badge> Fewer than{" "}
            {URGENT_DAYS} days left.
          </s-list-item>
          <s-list-item>
            <s-badge tone="caution">Reorder soon</s-badge> {URGENT_DAYS} to{" "}
            {SOON_DAYS} days left.
          </s-list-item>
          <s-list-item>
            <s-badge tone="success">OK</s-badge> {SOON_DAYS} days or more.
          </s-list-item>
          <s-list-item>
            <s-badge tone="neutral">No recent sales</s-badge> Nothing sold in
            the last {WINDOW_DAYS} days, so there&apos;s no rate to forecast
            from.
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Limits">
        <s-unordered-list>
          <s-list-item>
            It assumes the next {WINDOW_DAYS} days look like the last{" "}
            {WINDOW_DAYS}. Seasonal products, sales and new launches will be
            off.
          </s-list-item>
          <s-list-item>
            Stock is the total available across all locations.
          </s-list-item>
          <s-list-item>
            It reads up to 1,000 recent orders, which suits small stores. A
            bigger store would need Shopify&apos;s bulk operations instead.
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
