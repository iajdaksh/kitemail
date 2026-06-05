require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { nanoid } = require('nanoid');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Email transporter (optional)
let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// Generate Kite ID
function generateKiteId() {
  return 'KT-' + nanoid(8).toUpperCase();
}

// Normalize text for comparison
function normalize(str) {
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, pair) => {
    const [rawKey, ...rawValue] = pair.split('=');
    const key = rawKey?.trim();
    if (!key) return cookies;
    cookies[key] = decodeURIComponent(rawValue.join('=').trim() || '');
    return cookies;
  }, {});
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');

  const existing = res.getHeader('Set-Cookie');
  const cookies = Array.isArray(existing) ? existing : existing ? [existing] : [];
  res.setHeader('Set-Cookie', [...cookies, parts.join('; ')]);
}

function getOrCreateDeviceId(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const existingId = cookies.km_device?.trim();
  if (existingId) return existingId;

  const deviceId = crypto.randomUUID();
  setCookie(res, 'km_device', deviceId, {
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    sameSite: 'Lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  });
  return deviceId;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || req.ip || null;
}

function getRequestTracking(req, res) {
  return {
    sender_ip: getClientIp(req),
    sender_user_agent: req.get('user-agent') || null,
    sender_device_id: getOrCreateDeviceId(req, res),
    sender_accept_language: req.get('accept-language') || null,
    sender_referrer: req.get('referer') || req.get('referrer') || null
  };
}

function isBlockedSender(tracking) {
  const blockedIps = (process.env.BLOCKED_IPS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const blockedDeviceIds = (process.env.BLOCKED_DEVICE_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  return blockedIps.includes(tracking.sender_ip) || blockedDeviceIds.includes(tracking.sender_device_id);
}

async function insertKiteRecord(insertData) {
  const attempt = await supabase.from('kites').insert([insertData]).select('kite_id').single();
  if (!attempt.error) return attempt;

  const trackingFields = [
    'sender_ip',
    'sender_user_agent',
    'sender_device_id',
    'sender_accept_language',
    'sender_referrer'
  ];
  const isMissingTrackingColumn =
    attempt.error.code === 'PGRST204' ||
    trackingFields.some(field => String(attempt.error.message || '').includes(field));

  if (!isMissingTrackingColumn) return attempt;

  const fallbackData = { ...insertData };
  trackingFields.forEach(field => delete fallbackData[field]);
  console.warn('Tracking columns missing in database. Inserting kite without tracking metadata.');
  return supabase.from('kites').insert([fallbackData]).select('kite_id').single();
}

// Calculate similarity score (0-1) between two strings
function calculateSimilarity(str1, str2) {
  try {
    if (!str1 || !str2) return 0;
    const s1 = normalize(str1);
    const s2 = normalize(str2);
    
    // Exact match
    if (s1 === s2) return 1;
    
    // Levenshtein distance based similarity
    const len1 = s1.length;
    const len2 = s2.length;
    const maxLen = Math.max(len1, len2);
    
    if (maxLen === 0) return 1; // Both empty strings
    
    const dp = Array(len2 + 1).fill(0).map(() => Array(len1 + 1).fill(0));
    
    for (let i = 0; i <= len1; i++) dp[0][i] = i;
    for (let j = 0; j <= len2; j++) dp[j][0] = j;
    
    for (let j = 1; j <= len2; j++) {
      for (let i = 1; i <= len1; i++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[j][i] = Math.min(
          dp[j][i - 1] + 1,
          dp[j - 1][i] + 1,
          dp[j - 1][i - 1] + cost
        );
      }
    }
    
    const distance = dp[len2][len1];
    const similarity = 1 - (distance / maxLen);
    return Math.max(0, Math.min(1, similarity)); // Clamp between 0-1
  } catch (err) {
    console.error('Similarity calculation error:', err);
    return 0;
  }
}

// Helper: Get current stats
async function getStats() {
  try {
    // Count total kites (flied), ignoring deleted ones
    const { count: flied, error: err1 } = await supabase
      .from('kites')
      .select('*', { count: 'exact', head: true })
      .neq('is_deleted', true);
      
    if (err1) throw err1;

    // Count caught kites
    const { count: caught, error: err2 } = await supabase
      .from('kites')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'caught')
      .neq('is_deleted', true);
      
    if (err2) throw err2;

    return { 
      total_kites_flied: flied || 0, 
      total_kites_caught: caught || 0 
    };
  } catch (err) {
    console.error('Error fetching stats:', err);
    return { total_kites_flied: 0, total_kites_caught: 0 };
  }
}

// Helper: Generate letter-style HTML for kite
function generateKiteLetterHTML(kite) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { 
          margin: 0; 
          padding: 40px; 
          background: #0a0a0f; 
          font-family: 'Cormorant Garamond', Georgia, serif; 
          display: flex; 
          justify-content: center; 
          align-items: center; 
          min-height: 100vh;
        }
        .letter {
          width: 612px;
          height: 792px;
          background: #e8e0d0;
          color: #07070d;
          padding: 60px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          box-sizing: border-box;
          position: relative;
          overflow: hidden;
        }
        .letter::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(135deg, rgba(201,169,110,0.05), transparent);
          pointer-events: none;
        }
        .header {
          text-align: center;
          margin-bottom: 40px;
          border-bottom: 2px solid #c9a96e;
          padding-bottom: 20px;
        }
        .kite-icon { font-size: 48px; display: block; margin-bottom: 10px; }
        h1 { 
          font-size: 32px; 
          margin: 10px 0; 
          color: #c9a96e;
          font-weight: 300;
          letter-spacing: 2px;
        }
        .date { 
          font-size: 12px; 
          color: #6b6475; 
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .salutation { 
          font-size: 18px; 
          margin: 30px 0; 
          color: #07070d;
        }
        .message { 
          font-size: 16px; 
          line-height: 2; 
          color: #07070d; 
          margin: 40px 0;
          white-space: pre-wrap;
          font-style: italic;
        }
        .signature { 
          margin-top: 60px; 
          font-size: 14px; 
        }
        .signature-name { 
          margin-top: 40px; 
          font-size: 18px;
        }
        .footer {
          position: absolute;
          bottom: 30px;
          right: 30px;
          font-size: 12px;
          color: #9a9080;
          letter-spacing: 1px;
        }
        .kite-id {
          position: absolute;
          bottom: 30px;
          left: 30px;
          font-size: 12px;
          color: #c9a96e;
          font-family: monospace;
          letter-spacing: 2px;
        }
      </style>
    </head>
    <body>
      <div class="letter">
        <div class="header">
          <span class="kite-icon">🪁</span>
          <h1>A Kite Message</h1>
          <div class="date">${new Date(kite.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
        
        <div class="salutation">
          Dear <strong>${kite.beloved_nickname || kite.beloved_name}</strong>,
        </div>
        
        <div class="message">${kite.message}</div>
        
        <div class="signature">
          With affection,
          <div class="signature-name">${kite.is_anonymous ? 'An admirer' : (kite.sender_nickname || kite.sender_name || 'A friend')}</div>
        </div>
        
        <div class="footer">KiteMail — Messages carried by the wind</div>
        <div class="kite-id">${kite.kite_id}</div>
      </div>
    </body>
    </html>
  `;
}

function generateKiteTicketHTML(kite) {
  const sentAt = new Date(kite.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const caughtAt = kite.caught_at
    ? new Date(kite.caught_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : null;
  const statusLabel = kite.status === 'caught' ? 'Caught' : 'Flying';
  const statusIcon = kite.status === 'caught' ? '💌' : '🪁';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${kite.kite_id} Ticket</title>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 32px 16px;
          background: #14111a;
          color: #f5efe6;
          font-family: Georgia, serif;
        }
        .ticket {
          max-width: 620px;
          margin: 0 auto;
          background: linear-gradient(180deg, #211c2a 0%, #17131e 100%);
          border: 1px solid rgba(201, 169, 110, 0.28);
          border-radius: 28px;
          overflow: hidden;
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
        }
        .top {
          padding: 36px 36px 28px;
          text-align: center;
          border-bottom: 1px dashed rgba(201, 169, 110, 0.24);
        }
        .icon { font-size: 54px; margin-bottom: 10px; }
        .eyebrow {
          color: #c9a96e;
          font-size: 12px;
          letter-spacing: 3px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        h1 {
          margin: 0 0 8px;
          font-size: 38px;
          font-weight: 500;
        }
        .sub {
          margin: 0;
          color: #b7a99a;
          font-size: 15px;
          line-height: 1.7;
        }
        .body { padding: 28px 36px 36px; }
        .grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .row {
          padding: 18px 20px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(201, 169, 110, 0.12);
        }
        .label {
          color: #9a9080;
          font-size: 11px;
          letter-spacing: 1.8px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .value {
          color: #f5efe6;
          font-size: 18px;
          line-height: 1.5;
        }
        .mono {
          color: #c9a96e;
          font-family: "Courier New", monospace;
          letter-spacing: 3px;
        }
        .full { grid-column: 1 / -1; }
        .footer {
          margin-top: 24px;
          text-align: center;
          color: #9a9080;
          font-size: 12px;
          letter-spacing: 0.4px;
        }
        @media print {
          body { background: #ffffff; padding: 0; }
          .ticket {
            box-shadow: none;
            max-width: none;
            border-radius: 0;
            border-color: #d8c7a7;
          }
        }
        @media (max-width: 640px) {
          .grid { grid-template-columns: 1fr; }
          .top, .body { padding-left: 22px; padding-right: 22px; }
          h1 { font-size: 30px; }
        }
      </style>
    </head>
    <body>
      <div class="ticket">
        <div class="top">
          <div class="icon">${statusIcon}</div>
          <div class="eyebrow">KiteMail Ticket</div>
          <h1>Your kite is ${statusLabel.toLowerCase()}</h1>
          <p class="sub">Keep this ticket safe to track your message in the sky.</p>
        </div>
        <div class="body">
          <div class="grid">
            <div class="row">
              <div class="label">Kite ID</div>
              <div class="value mono">${kite.kite_id}</div>
            </div>
            <div class="row">
              <div class="label">Status</div>
              <div class="value">${statusLabel}</div>
            </div>
            <div class="row full">
              <div class="label">For</div>
              <div class="value">${kite.beloved_name} (${kite.beloved_nickname})</div>
            </div>
            <div class="row">
              <div class="label">Sent On</div>
              <div class="value">${sentAt}</div>
            </div>
            <div class="row">
              <div class="label">Caught On</div>
              <div class="value">${caughtAt || 'Still flying'}</div>
            </div>
          </div>
          <div class="footer">KiteMail — Messages carried by the wind</div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// POST /api/fly — Send a kite
app.post('/api/fly', async (req, res) => {
  try {
    const {
      beloved_name, beloved_nickname, beloved_dob,
      message,
      question_1, answer_1, hint_1,
      question_2, answer_2, hint_2,
      question_3, answer_3, hint_3,
      sender_name, sender_nickname, sender_dob,
      sender_email, is_anonymous
    } = req.body;

    // Validation
    if (!beloved_name || !beloved_nickname || !beloved_dob || !message) {
      return res.status(400).json({ error: 'Beloved details and message are required.' });
    }
    if (!question_1 || !answer_1 || !question_2 || !answer_2 || !question_3 || !answer_3) {
      return res.status(400).json({ error: 'All 3 security questions and answers are required.' });
    }
    if (!sender_dob) {
      return res.status(400).json({ error: 'Your date of birth is required.' });
    }
    if (!is_anonymous && !sender_name && !sender_nickname) {
      return res.status(400).json({ error: 'Please provide your name or nickname.' });
    }

    // DOB format validation DD/MM
    const dobRegex = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])$/;
    if (!dobRegex.test(beloved_dob) || !dobRegex.test(sender_dob)) {
      return res.status(400).json({ error: 'Date must be in DD/MM format.' });
    }

    const tracking = getRequestTracking(req, res);
    if (isBlockedSender(tracking)) {
      return res.status(403).json({ error: 'This device is blocked from sending new kites.' });
    }

    const kite_id = generateKiteId();

    const insertData = {
      kite_id,
      beloved_name: beloved_name.trim(),
      beloved_nickname: beloved_nickname.trim(),
      beloved_dob: beloved_dob.trim(),
      message: message.trim(),
      question_1: question_1.trim(), answer_1: normalize(answer_1), hint_1: hint_1?.trim() || null,
      question_2: question_2.trim(), answer_2: normalize(answer_2), hint_2: hint_2?.trim() || null,
      question_3: question_3.trim(), answer_3: normalize(answer_3), hint_3: hint_3?.trim() || null,
      sender_dob: sender_dob.trim(),
      sender_email: sender_email?.trim() || null,
      is_anonymous: Boolean(is_anonymous),
      sender_name: is_anonymous ? null : (sender_name?.trim() || null),
      sender_nickname: is_anonymous ? null : (sender_nickname?.trim() || null),
      status: 'flying',
      ...tracking
    };

    const { data, error } = await insertKiteRecord(insertData);

    if (error) throw error;

    // Send ticket email if email provided
    if (sender_email && transporter) {
      await sendTicketEmail(sender_email, kite_id, beloved_name);
    }

    return res.json({ success: true, kite_id });

  } catch (err) {
    console.error('Fly error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /api/find — Search for kites
app.post('/api/find', async (req, res) => {
  try {
    const { beloved_name, beloved_nickname, beloved_dob, sender_dob } = req.body;

    if (!beloved_name || !beloved_nickname || !beloved_dob) {
      return res.status(400).json({ error: 'Name, nickname and date of birth are required.' });
    }
    
    // Validate DOB format to prevent silent mismatch
    const dobRegex = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])$/;
    if (!dobRegex.test(beloved_dob)) {
      return res.status(400).json({ error: 'Date must be in DD/MM format (e.g. 05/09).' });
    }

    console.log(`[FIND] Searching for: ${beloved_name} / ${beloved_nickname} / ${beloved_dob}`);

    let query = supabase
      .from('kites')
      .select('id, kite_id, question_1, hint_1, question_2, hint_2, question_3, hint_3, created_at, status, is_anonymous, sender_name, sender_nickname, sender_dob, is_deleted, beloved_name, beloved_nickname')
      .eq('beloved_dob', beloved_dob.trim())
      .eq('status', 'flying');

    // If sender_dob filter provided
    if (sender_dob && sender_dob.trim()) {
      query = query.eq('sender_dob', sender_dob.trim());
    }

    const { data, error } = await query;
    if (error) {
      console.error('[FIND] Database error:', error);
      throw error;
    }

    console.log(`[FIND] Database returned ${data?.length || 0} kites`);

    if (!data || data.length === 0) {
      console.log('[FIND] No kites found in database');
      return res.json({ found: false, kites: [] });
    }

    // Filter out deleted kites and score by similarity
    const threshold = 0.70; // 70% similarity threshold (30% typo tolerance)
    const activeKites = [];
    
    for (const k of data) {
      try {
        if (k.is_deleted) {
          console.log(`[FIND] Skipping deleted kite: ${k.id}`);
          continue;
        }
        
        const nameSim = calculateSimilarity(beloved_name, k.beloved_name);
        const nicknameSim = calculateSimilarity(beloved_nickname, k.beloved_nickname);
        
        console.log(`[FIND] Kite ${k.id}: name="${k.beloved_name}" (${nameSim.toFixed(2)}), nickname="${k.beloved_nickname}" (${nicknameSim.toFixed(2)})`);
        
        if (nameSim >= threshold && nicknameSim >= threshold) {
          activeKites.push({
            ...k,
            nameSimilarity: nameSim,
            nicknameSimilarity: nicknameSim
          });
        }
      } catch (err) {
        console.error(`[FIND] Error processing kite ${k?.id}:`, err.message);
      }
    }

    // Sort by combined similarity score
    activeKites.sort((a, b) => {
      const scoreA = (a.nameSimilarity + a.nicknameSimilarity) / 2;
      const scoreB = (b.nameSimilarity + b.nicknameSimilarity) / 2;
      return scoreB - scoreA;
    });

    console.log(`[FIND] Found ${activeKites.length} matching kites after filtering`);

    if (!activeKites || activeKites.length === 0) {
      return res.json({ found: false, kites: [] });
    }

    // Return kites without sensitive data (remove similarity scores from response)
    const kites = activeKites.map(k => ({
      id: k.id,
      kite_id: k.kite_id,
      questions: [
        { q: k.question_1, hint: k.hint_1, idx: 1 },
        { q: k.question_2, hint: k.hint_2, idx: 2 },
        { q: k.question_3, hint: k.hint_3, idx: 3 },
      ],
      created_at: k.created_at,
      status: k.status,
      sender_visible: !k.is_anonymous ? {
        name: k.sender_name,
        nickname: k.sender_nickname
      } : null
    }));

    console.log(`[FIND] Returning ${kites.length} kites`);
    return res.json({ found: true, kites, multiple: kites.length > 1 });

  } catch (err) {
    console.error('[FIND] Error:', err);
    return res.status(500).json({ error: err.message || 'Something went wrong. Please try again.' });
  }
});

// POST /api/catch — Attempt to catch (answer questions)
app.post('/api/catch', async (req, res) => {
  try {
    const { kite_db_id, answers } = req.body;
    // answers: { 1: "answer", 2: "answer", 3: "answer" }

    if (!kite_db_id || !answers) {
      return res.status(400).json({ error: 'Invalid request.' });
    }

    const { data: kite, error } = await supabase
      .from('kites')
      .select('*')
      .eq('id', kite_db_id)
      .single();

    if (error || !kite) {
      return res.status(404).json({ error: 'Kite not found.' });
    }

    // Check answers — need 2 out of 3 correct
    let correct = 0;
    const correctAnswers = [kite.answer_1, kite.answer_2, kite.answer_3];

    [1, 2, 3].forEach(i => {
      if (answers[i] && normalize(answers[i]) === correctAnswers[i - 1]) {
        correct++;
      }
    });

    if (correct < 2) {
      return res.json({ success: false, correct, message: 'Not enough correct answers. Try again.' });
    }

    // Mark as caught
    const now = new Date().toISOString();
    await supabase.from('kites').update({ status: 'caught', caught_at: now }).eq('id', kite_db_id);

    return res.json({
      success: true,
      message: kite.message,
      sender: kite.is_anonymous ? null : { name: kite.sender_name, nickname: kite.sender_nickname },
      is_anonymous: kite.is_anonymous,
      sent_at: kite.created_at
    });

  } catch (err) {
    console.error('Catch error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// GET /api/ticket/:kite_id — Get ticket status
app.get('/api/ticket/:kite_id', async (req, res) => {
  try {
    const { kite_id } = req.params;

    const { data, error } = await supabase
      .from('kites')
      .select('kite_id, beloved_name, beloved_nickname, status, created_at, caught_at, is_anonymous')
      .eq('kite_id', kite_id.toUpperCase())
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    return res.json({
      kite_id: data.kite_id,
      beloved_name: data.beloved_name,
      beloved_nickname: data.beloved_nickname,
      status: data.status,
      sent_at: data.created_at,
      caught_at: data.caught_at || null
    });

  } catch (err) {
    console.error('Ticket error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /api/stats — Get kite statistics
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
    return res.json(stats);
  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /api/download/:kite_id — Download kite as PNG
app.get('/api/download/:kite_id', async (req, res) => {
  try {
    const { kite_id } = req.params;

    const { data: kite, error } = await supabase
      .from('kites')
      .select('*')
      .eq('kite_id', kite_id.toUpperCase())
      .eq('status', 'caught')
      .single();

    if (error || !kite) {
      return res.status(404).json({ error: 'Kite not found or not caught yet.' });
    }

    // Generate HTML letter
    const html = generateKiteLetterHTML(kite);

    // Return the HTML with a note about client-side rendering
    res.type('text/html');
    res.send(html);

  } catch (err) {
    console.error('Download error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /api/ticket-download/:kite_id — Download tracking ticket as HTML
app.get('/api/ticket-download/:kite_id', async (req, res) => {
  try {
    const { kite_id } = req.params;

    const { data: kite, error } = await supabase
      .from('kites')
      .select('kite_id, beloved_name, beloved_nickname, status, created_at, caught_at')
      .eq('kite_id', kite_id.toUpperCase())
      .single();

    if (error || !kite) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const html = generateKiteTicketHTML(kite);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${kite.kite_id}-ticket.html"`);
    return res.send(html);
  } catch (err) {
    console.error('Ticket download error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/delete/:kite_id — Delete a caught kite
app.post('/api/delete/:kite_id', async (req, res) => {
  try {
    const { kite_id } = req.params;

    const { data: kite, error: fetchError } = await supabase
      .from('kites')
      .select('id, status')
      .eq('kite_id', kite_id.toUpperCase())
      .single();

    if (fetchError || !kite) {
      return res.status(404).json({ error: 'Kite not found.' });
    }

    if (kite.status !== 'caught') {
      return res.status(400).json({ error: 'Only caught kites can be deleted.' });
    }

    // Mark as deleted (soft delete to preserve stats)
    const now = new Date().toISOString();
    const { error: deleteError } = await supabase
      .from('kites')
      .update({ is_deleted: true, deleted_at: now })
      .eq('id', kite.id);

    if (deleteError) throw deleteError;

    return res.json({ success: true, message: 'Kite deleted successfully.' });

  } catch (err) {
    console.error('Delete error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ─── EMAIL ────────────────────────────────────────────────────────────────────

async function sendTicketEmail(email, kite_id, beloved_name) {
  try {
    await transporter.sendMail({
      from: `KiteMail <${process.env.SMTP_FROM}>`,
      to: email,
      subject: `Your kite is flying 🪁 — ${kite_id}`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; background: #0a0a0f; color: #e8e0d0; padding: 40px; border-radius: 12px;">
          <h1 style="color: #c9a96e; font-size: 28px; margin-bottom: 8px;">🪁 Your kite is in the sky</h1>
          <p style="color: #9a9080; font-size: 14px; margin-bottom: 32px;">Flying towards <strong style="color:#e8e0d0;">${beloved_name}</strong></p>
          <div style="background: #13131a; border: 1px solid #2a2a3a; border-radius: 8px; padding: 24px; margin-bottom: 32px;">
            <p style="color: #6b6475; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 8px;">Kite ID</p>
            <p style="color: #c9a96e; font-size: 28px; font-family: monospace; letter-spacing: 4px; margin: 0;">${kite_id}</p>
          </div>
          <p style="color: #9a9080; font-size: 14px; line-height: 1.8;">Use this ID anytime to check if your kite has been caught. Keep it safe — this is your only proof that your kite is flying.</p>
          <hr style="border: none; border-top: 1px solid #2a2a3a; margin: 32px 0;" />
          <p style="color: #4a4450; font-size: 12px;">KiteMail — Messages carried by the wind</p>
        </div>
      `
    });
  } catch (e) {
    console.error('Email send error:', e);
  }
}

// ─── PAGE ROUTES ──────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/fly', (req, res) => res.sendFile(path.join(__dirname, 'public', 'fly.html')));
app.get('/find', (req, res) => res.sendFile(path.join(__dirname, 'public', 'find.html')));
app.get('/ticket', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ticket.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
app.get('/safety', (req, res) => res.sendFile(path.join(__dirname, 'public', 'safety.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));

// 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => {
  console.log(`🪁 KiteMail running on http://localhost:${PORT}`);
});

module.exports = app;
