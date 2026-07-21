// Creates a Shopify draft order for the exact rental total and returns
// the hosted invoice_url so the customer can pay it directly.
//
// Required Netlify environment variables (Project configuration > Environment variables):
//   SHOPIFY_STORE_DOMAIN     e.g. cxffeeblack.myshopify.com
//   SHOPIFY_ADMIN_API_TOKEN  Admin API access token from a custom app
//                            (needs the write_draft_orders scope)

const fetch = require('node-fetch');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const { fullName, email, phone, eventType, eventDate, startTime, endTime, notes, total } = data;

  if (!fullName || !email || !eventDate || !startTime || !endTime || !total) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required booking details.' }) };
  }

  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_API_TOKEN;

  if (!shop || !token) {
    console.error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_API_TOKEN env vars');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured for payments yet.' }) };
  }

  const draftOrderBody = {
    draft_order: {
      line_items: [
        {
          title: `Cxffeeblack Space Rental — ${eventDate} (${startTime}-${endTime})`,
          price: Number(total).toFixed(2),
          quantity: 1,
          requires_shipping: false,
          taxable: false
        }
      ],
      email: email,
      note:
        `Renter: ${fullName}\n` +
        `Phone: ${phone || 'N/A'}\n` +
        `Event type: ${eventType || 'N/A'}\n` +
        `Notes: ${notes || 'None'}`,
      use_customer_default_address: false
    }
  };

  try {
    const resp = await fetch(`https://${shop}/admin/api/2024-01/draft_orders.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(draftOrderBody)
    });

    const result = await resp.json();

    if (!resp.ok) {
      console.error('Shopify draft order error:', result);
      return { statusCode: 500, body: JSON.stringify({ error: 'Shopify could not create the checkout.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ invoice_url: result.draft_order.invoice_url })
    };
  } catch (err) {
    console.error('Shopify request failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error creating checkout.' }) };
  }
};
