import { useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getRunoutReport } from "../runout/shopify-data.server";
import { addDemoData } from "../runout/demo-data.server";
import { URGENT_DAYS, SOON_DAYS } from "../runout/forecast";

// The loader runs on the server every time the page opens: it fetches the
// data from Shopify and works out the forecasts.
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    return { report: await getRunoutReport(admin), error: null };
  } catch (error) {
    return { report: null, error: error.message };
  }
};

// The action runs on the server when the "Add demo data" button is clicked.
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    return await addDemoData(admin);
  } catch (error) {
    return { error: error.message };
  }
};

// How each status looks in the table.
const STATUS_BADGES = {
  out: { tone: "critical", label: "Out of stock" },
  urgent: { tone: "warning", label: "Reorder now" },
  soon: { tone: "caution", label: "Reorder soon" },
  ok: { tone: "success", label: "OK" },
  "no-sales": { tone: "neutral", label: "No recent sales" },
};

const SUMMARY_CARDS = [
  { status: "out", label: "Out of stock" },
  { status: "urgent", label: `Under ${URGENT_DAYS} days left` },
  { status: "soon", label: `${URGENT_DAYS}–${SOON_DAYS} days left` },
  { status: "ok", label: "Enough stock" },
];

/** Turns "gid://shopify/Product/123" into a link to that product in the admin. */
function productAdminUrl(productId) {
  return `shopify://admin/products/${productId.split("/").pop()}`;
}

function formatDaysLeft(daysLeft) {
  if (daysLeft === null) return "—";
  if (daysLeft === 0) return "0";
  return `${Math.floor(daysLeft)}`;
}

export default function Index() {
  const { report, error } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const isAddingDemo = fetcher.state !== "idle";
  const addDemo = () => fetcher.submit({}, { method: "POST" });

  // Show a short pop-up message once adding demo data finishes.
  useEffect(() => {
    const result = fetcher.data;
    if (!result) return;
    if (result.error) {
      shopify.toast.show(result.error, { isError: true });
    } else if (result.created) {
      shopify.toast.show(`Added ${result.products} demo products and ${result.orders} orders`);
    } else {
      shopify.toast.show("Demo data is already in this store");
    }
  }, [fetcher.data, shopify]);

  const demoButton = (
    <s-button onClick={addDemo} {...(isAddingDemo ? { loading: true } : {})}>
      Add demo data
    </s-button>
  );

  return (
    <s-page heading="Runout">
      <s-button
        slot="primary-action"
        onClick={() => revalidator.revalidate()}
        {...(revalidator.state === "loading" ? { loading: true } : {})}
      >
        Refresh
      </s-button>

      {error && (
        <s-banner heading="Couldn't load your store's data" tone="critical">
          {error}
        </s-banner>
      )}

      {report && report.rows.length === 0 && (
        <s-section heading="No products to forecast yet">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Runout forecasts products whose inventory Shopify tracks. Add
              tracked products, or fill this test store with demo products and
              orders to see how it works.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              {demoButton}
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {report && report.rows.length > 0 && (
        <>
          <s-section heading={`Sell-out forecast, based on the last ${report.windowDays} days of sales`}>
            <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
              {SUMMARY_CARDS.map((card) => (
                <s-box key={card.status} padding="base" border="base" borderRadius="base">
                  <s-stack direction="block" gap="small-200">
                    <s-text color="subdued">{card.label}</s-text>
                    <s-heading>{report.summary[card.status]}</s-heading>
                  </s-stack>
                </s-box>
              ))}
            </s-grid>
          </s-section>

          <s-section padding="none">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header format="numeric">In stock</s-table-header>
                <s-table-header format="numeric">Sold ({report.windowDays} days)</s-table-header>
                <s-table-header format="numeric">Sold per day</s-table-header>
                <s-table-header listSlot="labeled" format="numeric">Days left</s-table-header>
                <s-table-header format="numeric">Suggested reorder</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {report.rows.map((row) => {
                  const badge = STATUS_BADGES[row.status];
                  return (
                    <s-table-row key={row.id}>
                      <s-table-cell>
                        <s-link href={productAdminUrl(row.productId)}>{row.name}</s-link>
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge tone={badge.tone}>{badge.label}</s-badge>
                      </s-table-cell>
                      <s-table-cell>{row.inStock}</s-table-cell>
                      <s-table-cell>{row.unitsSold}</s-table-cell>
                      <s-table-cell>{row.dailyRate.toFixed(1)}</s-table-cell>
                      <s-table-cell>{formatDaysLeft(row.daysLeft)}</s-table-cell>
                      <s-table-cell>{row.reorderQuantity > 0 ? row.reorderQuantity : "—"}</s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </s-section>
        </>
      )}

      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          For each product, Runout divides the units sold in the last{" "}
          {report?.windowDays ?? 30} days by the number of days to get a daily
          sales rate. Stock left divided by that rate is the number of days
          until it sells out.
        </s-paragraph>
        <s-paragraph>
          Suggested reorder is how many more units you need to cover the next{" "}
          {report?.windowDays ?? 30} days at the same rate.
        </s-paragraph>
        <s-link href="/app/how-it-works">More about the forecast</s-link>
      </s-section>

      <s-section slot="aside" heading="Try it with demo data">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Adds 6 coffee-shop products and 5 orders from the last 30 days to
            this store. Use it on test stores only.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            {demoButton}
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
