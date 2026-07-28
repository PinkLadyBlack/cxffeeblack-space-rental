// Creates a calendar event for a space rental booking on TWO Google Calendars:
// Renata's personal calendar and Cxffeeblack's Workspace calendar.
//
// Required Netlify environment variables (Project configuration > Environment variables):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   the service account's client_email (from its JSON key)
//   GOOGLE_PRIVATE_KEY             the service account's private_key (from its JSON key,
//                                  paste it exactly as-is, including the BEGIN/END lines —
//                                  Netlify preserves newlines fine in a multi-line value)
//   GOOGLE_CALENDAR_ID_PERSONAL    Renata's personal calendar ID (usually her email address)
//   GOOGLE_CALENDAR_ID_CXFFEEBLACK Cxffeeblack's Workspace calendar ID (its calendar's email
//                                  address, e.g. bookings@cxffeeblack.com)
//
// Both calendars must be individually SHARED with the service account's email address
// (Calendar settings > "Share with specific people" > add the service account email >
// "Make changes to events" permission) before this will work.

const fetch = require('node-fetch');
const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!email || !key) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env vars');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claim));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(key).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = unsigned + '.' + signature;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error('Failed to get Google access token: ' + JSON.stringify(data));
  }
  return data.access_token;
}

function buildEventBody(details) {
  const {
    fullName, email, phone, eventName, eventType, headcount,
    eventDate, startTime, endTime, notes, total, waived
  } = details;

  const description =
    `Renter: ${fullName}\n` +
    `Email: ${email}\n` +
    `Phone: ${phone || 'N/A'}\n` +
    `Event type: ${eventType || 'N/A'}\n` +
    `Headcount: ${headcount || 'N/A'}\n` +
    `Notes: ${notes || 'None'}\n` +
    `${waived ? 'Payment: WAIVED (free booking)' : 'Total due: $' + Number(total).toFixed(0)}`;

  return {
    summary: `${eventName} — Cxffeeblack Space Rental`,
    location: '3386 Bowen Ave, Memphis, TN',
    description,
    start: { dateTime: `${eventDate}T${startTime}:00`, timeZone: 'America/Chicago' },
    end: { dateTime: `${eventDate}T${endTime}:00`, timeZone: 'America/Chicago' }
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let details;
  try {
    details = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const { fullName, email, eventName, eventDate, startTime, endTime } = details;
  if (!fullName || !email || !eventName || !eventDate || !startTime || !endTime) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required booking details.' }) };
  }

  const calendarIds = [
    process.env.GOOGLE_CALENDAR_ID_PERSONAL,
    process.env.GOOGLE_CALENDAR_ID_CXFFEEBLACK
  ].filter(Boolean);

  if (calendarIds.length === 0) {
    console.error('No calendar IDs configured');
    return { statusCode: 500, body: JSON.stringify({ error: 'No calendars configured.' }) };
  }

  try {
    const token = await getAccessToken();
    const eventBody = buildEventBody(details);

    const results = await Promise.all(calendarIds.map(async (calendarId) => {
      const resp = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(eventBody)
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        console.error(`Calendar insert failed for ${calendarId}:`, data);
        return { calendarId, ok: false, error: data };
      }
      return { calendarId, ok: true, eventId: data.id };
    }));

    const allOk = results.every(r => r.ok);
    return {
      statusCode: allOk ? 200 : 207,
      body: JSON.stringify({ results })
    };
  } catch (err) {
    console.error('Calendar event creation failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error creating calendar events.' }) };
  }
};
