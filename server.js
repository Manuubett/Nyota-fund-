// server.js
// Minimal Express backend for the TalkSasa SMS Test Console.
// Keeps TALKSASA_API_KEY on the server; the browser only ever talks to /api/*.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Config (from environment variables) -----------------------------
const API_KEY = process.env.TALKSASA_API_KEY || '';
const DEFAULT_SENDER_ID = process.env.TALKSASA_SENDER_ID || '';
const BASE_URL = (process.env.TALKSASA_BASE_URL || 'https://bulksms.talksasa.com/api/v3').replace(/\/+$/, '');
const SEND_PATH = (process.env.TALKSASA_SEND_PATH || '/sms/send').replace(/^\/*/, '/');

const SEND_URL = `${BASE_URL}${SEND_PATH}`;

app.use(express.json());

// ---- CORS (needed so local test pages like Live Server can call this API) ----
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ---- Helpers -----------------------------------------------------------
function normalizeKenyanNumber(raw) {
  let n = String(raw || '').replace(/[\s\-+]/g, '');
  if (n.startsWith('0')) n = '254' + n.slice(1);
  else if (n.length === 9) n = '254' + n;
  return n;
}

function isValidE164Kenya(n) {
  return /^254\d{9}$/.test(n);
}

// ---- Routes -------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    apiKeyConfigured: Boolean(API_KEY),
    baseUrl: BASE_URL,
    sendPath: SEND_PATH,
  });
});

app.post('/api/send-sms', async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        ok: false,
        error: 'Server is missing TALKSASA_API_KEY. Set it as an environment variable and restart.',
      });
    }

    const { recipient, message, sender_id } = req.body || {};

    if (!recipient || typeof recipient !== 'string') {
      return res.status(400).json({ ok: false, error: 'A recipient number is required.' });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ ok: false, error: 'A message body is required.' });
    }

    const normalized = normalizeKenyanNumber(recipient);
    let warning;
    if (!isValidE164Kenya(normalized)) {
      warning = `"${recipient}" didn't normalize to a valid 254XXXXXXXXX number — sending as-is.`;
    }
    const sentTo = isValidE164Kenya(normalized) ? normalized : recipient;

    const payload = {
      recipient: sentTo,
      sender_id: (sender_id && String(sender_id).trim()) || DEFAULT_SENDER_ID || undefined,
      type: 'plain',
      message,
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const upstream = await fetch(SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        ok: false,
        sentTo,
        warning,
        error: parsed,
      });
    }

    return res.json({
      ok: true,
      sentTo,
      warning,
      response: parsed,
    });
  } catch (err) {
    console.error('send-sms error:', err);
    return res.status(500).json({ ok: false, error: `Server error: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`TalkSasa test console listening on :${PORT}`);
  console.log(`  API key configured: ${Boolean(API_KEY)}`);
  console.log(`  Sending via: ${SEND_URL}`);
});
