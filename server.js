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

// Kite Themes Configuration
const THEMES = {
  default: { primary: '#d97d54', bg: '#f2f7fa', gradient: 'rgba(217, 125, 84, 0.05)' },
  midnight: { primary: '#4f6187', bg: '#f0f3f7', gradient: 'rgba(79, 97, 135, 0.05)' },
  sunset: { primary: '#e66a6a', bg: '#fff5f5', gradient: 'rgba(230, 106, 106, 0.05)' },
  forest: { primary: '#6d8c6f', bg: '#f2f7f2', gradient: 'rgba(109, 140, 111, 0.05)' }
};
function getTheme(name) { return THEMES[name] || THEMES.default; }

// Geolocation Helpers
async function getGeoLocation(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.')) return null;
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city,lat,lon`);
    const data = await res.json();
    if (data.status === 'success') return { city: data.city, country: data.country, lat: data.lat, lon: data.lon };
  } catch (e) { console.error('Geo error:', e.message); }
  return null;
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  return Math.round(R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))));
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

async function isBlockedSender(tracking) {
  try {
    const { data } = await supabase.from('blocked_ips').select('ip_address').eq('ip_address', tracking.sender_ip).single();
    if (data) return true;
  } catch (e) {}

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

// Auto-cleanup for kites caught more than 3 days ago
let lastCleanup = 0;
async function cleanupOldKites() {
  const now = Date.now();
  // Execute at most once per hour to avoid unnecessary database calls
  if (now - lastCleanup < 60 * 60 * 1000) return;
  lastCleanup = now;

  try {
    await supabase
      .from('kites')
      .delete()
      .eq('status', 'flying')
      .lt('expires_at', new Date().toISOString());
  } catch (err) {
    console.error('Expired kite cleanup error:', err);
  }

  try {
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    
    const { error } = await supabase
      .from('kites')
      .delete()
      .eq('status', 'caught')
      .lt('caught_at', threeDaysAgo);
      
    if (error) console.error('Kite cleanup database error:', error);
  } catch (err) {
    console.error('Kite cleanup execution error:', err);
  }
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
  const bg = kite.bg_color || '#ffffff';
  const textCol = kite.text_color || '#1e2532';
  const font = kite.font_family || 'Bodoni Moda';
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,300;0,6..96,400;0,6..96,500;1,6..96,300;1,6..96,400;1,6..96,500&family=Caveat:wght@400;500&family=Dancing+Script:wght@400;500&family=Pacifico&family=Playfair+Display:ital,wght@0,400;1,400&family=Space+Mono:ital,wght@0,400;1,400&display=swap');
        body { 
          margin: 0; 
          padding: 40px; 
          background: #f2f7fa; 
          font-family: 'Bodoni Moda', Georgia, serif; 
          display: flex; 
          justify-content: center; 
          align-items: center; 
          min-height: 100vh;
        }
        .letter {
          width: 612px;
          min-height: 792px;
          background: ${bg};
          color: ${textCol};
          padding: 40px 44px 34px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.08);
          box-sizing: border-box;
          position: relative;
          display: flex;
          flex-direction: column;
        }
        .header {
          text-align: center;
          margin-bottom: 18px;
      border-bottom: 1px solid rgba(0,0,0,0.08);
          padding-bottom: 14px;
        }
        .kite-icon { font-size: 28px; display: block; margin-bottom: 6px; }
        h1 { 
          font-size: 24px; 
          margin: 6px 0; 
          color: ${textCol};
          font-weight: 300;
          letter-spacing: 2px;
          font-family: 'Bodoni Moda', Georgia, serif; 
        }
        .date { 
          font-size: 11px; 
          color: ${textCol}; 
          opacity: 0.7;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .message { 
          font-size: 16px; 
          line-height: 2; 
          color: ${textCol}; 
          margin: 16px 0 0;
          white-space: pre-wrap;
          font-style: italic;
          flex: 1;
          font-family: '${font}', Georgia, serif; 
        }
        .footer {
          margin-top: 24px;
          padding-top: 14px;
      border-top: 1px solid rgba(0,0,0,0.08);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          font-size: 12px;
          color: ${textCol};
          opacity: 0.8;
          letter-spacing: 1px;
        }
        .footer-note {
          white-space: nowrap;
        }
        .kite-id {
          font-size: 12px;
          color: ${textCol};
          font-family: monospace;
          letter-spacing: 2px;
          white-space: nowrap;
        }
        .sender-name {
          font-style: italic;
          color: ${textCol};
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
        
        <div class="message">${kite.message}</div>
        
        <div class="footer">
          <div class="kite-id">${kite.kite_id}</div>
          <div class="sender-name">${kite.is_anonymous ? 'Anonymous' : (kite.sender_name || kite.sender_nickname)}</div>
        </div>
      </div>
      <div style="text-align: center; margin-top: 24px;">
        <a href="${process.env.APP_URL || 'http://localhost:3000'}/report?kite_id=${kite.kite_id}" style="color: #798699; font-size: 12px; font-family: sans-serif; text-decoration: underline;">Report this kite</a>
      </div>
      <script>
        window.addEventListener('load', () => {
          const element = document.querySelector('.letter');
          const opt = {
            margin:       0,
            filename:     'Kite-${kite.kite_id}.pdf',
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'pt', format: 'letter', orientation: 'portrait' }
          };
          html2pdf().set(opt).from(element).save();
        });
      </script>
    </body>
    </html>
  `;
}

function generateKiteTicketHTML(kite) {
  const t = getTheme(kite.theme_color);
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
      <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500&family=Outfit:wght@300;400;500&display=swap');
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 32px 16px;
      background: ${t.bg};
      color: #1e2532;
          font-family: 'Outfit', sans-serif;
        }
        .ticket {
          max-width: 620px;
          margin: 0 auto;
      background: linear-gradient(180deg, #ffffff 0%, #f9fbfc 100%);
      border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 28px;
          overflow: hidden;
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.06);
        }
        .top {
          padding: 36px 36px 28px;
          text-align: center;
      border-bottom: 1px dashed rgba(0, 0, 0, 0.08);
        }
        .icon { font-size: 54px; margin-bottom: 10px; }
        .eyebrow {
      color: ${t.primary};
          font-size: 12px;
          letter-spacing: 3px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        h1 {
          margin: 0 0 8px;
          font-size: 38px;
          font-family: 'Bodoni Moda', Georgia, serif;
          font-weight: 500;
        }
        .sub {
          margin: 0;
      color: #546070;
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
      background: rgba(0, 0, 0, 0.02);
      border: 1px solid rgba(0, 0, 0, 0.04);
        }
        .label {
      color: #798699;
          font-size: 11px;
          letter-spacing: 1.8px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .value {
      color: #1e2532;
          font-size: 18px;
          line-height: 1.5;
        }
        .mono {
      color: ${t.primary};
          font-family: "Courier New", monospace;
          letter-spacing: 3px;
        }
        .full { grid-column: 1 / -1; }
        .footer {
          margin-top: 24px;
          text-align: center;
      color: #798699;
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
              <div class="label">Released On</div>
              <div class="value">${sentAt}</div>
            </div>
            <div class="row">
              <div class="label">Caught On</div>
              <div class="value">${caughtAt || 'Still flying'}</div>
            </div>
          ${kite.flight_distance_km ? `
          <div class="row">
            <div class="label">Flight Distance</div>
            <div class="value">${kite.flight_distance_km} km</div>
          </div>
          ` : ''}
          ${kite.catcher_location?.city ? `
          <div class="row">
            <div class="label">Caught In</div>
            <div class="value">${kite.catcher_location.city}, ${kite.catcher_location.country}</div>
          </div>
          ` : ''}
          ${kite.reply_message ? `
          <div class="row full">
            <div class="label">A Breeze Back</div>
            <div class="value" style="font-style: italic;">"${kite.reply_message}"</div>
          </div>
          ` : ''}
          </div>
          <div class="footer">KiteMail — Messages carried by the wind</div>
        </div>
      </div>
      <div style="text-align: center; margin-top: 24px;">
        <a href="${process.env.APP_URL || 'http://localhost:3000'}/report?kite_id=${kite.kite_id}" style="color: #798699; font-size: 12px; font-family: 'Outfit', sans-serif; text-decoration: underline;">Report this ticket</a>
      </div>
      <script>
        window.addEventListener('load', () => {
          setTimeout(() => {
            const element = document.querySelector('.ticket');
            const originalShadow = element.style.boxShadow;
            element.style.boxShadow = 'none'; // Temporarily hide shadow for a cleaner PNG bounding box
            html2canvas(element, { scale: 2, backgroundColor: null }).then(canvas => {
              element.style.boxShadow = originalShadow;
              const link = document.createElement('a');
              link.href = canvas.toDataURL('image/png');
              link.download = '${kite.kite_id}-ticket.png';
              link.click();
              setTimeout(() => window.close(), 500);
            });
          }, 500);
        });
      </script>
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
      sender_email, is_anonymous, available_after, expires_at, is_public, theme_color, bg_color, text_color, font_family
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
    if (!sender_email || !sender_email.includes('@')) {
      return res.status(400).json({ error: 'A valid email is required for tracking and notifications.' });
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
    if (await isBlockedSender(tracking)) {
      return res.status(403).json({ error: 'This device is blocked from sending new kites.' });
    }

    const kite_id = generateKiteId();
    
    // Get optional location data
    const sender_location = await getGeoLocation(tracking.sender_ip);

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
      theme_color: theme_color || 'default',
      bg_color: bg_color || '#ffffff',
      text_color: text_color || '#1e2532',
      font_family: font_family || 'Bodoni Moda',
      is_public: Boolean(is_public),
      available_after: available_after ? new Date(available_after).toISOString() : null,
      expires_at: expires_at ? new Date(expires_at).toISOString() : null,
      sender_location,
      ...tracking
    };

    const { data, error } = await insertKiteRecord(insertData);

    if (error) throw error;

    // Send ticket email if email provided
    if (sender_email && transporter) {
      await sendTicketEmail(sender_email, kite_id, beloved_name, insertData.theme_color);
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
      .select('id, kite_id, question_1, hint_1, question_2, hint_2, question_3, hint_3, created_at, status, is_anonymous, sender_name, sender_nickname, sender_dob, is_deleted, beloved_name, beloved_nickname, expires_at')
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
    const now = new Date();
    
    for (const k of data) {
      try {
        if (k.is_deleted) {
          console.log(`[FIND] Skipping deleted kite: ${k.id}`);
          continue;
        }

        if (k.expires_at && new Date(k.expires_at) < now) {
          console.log(`[FIND] Skipping expired kite: ${k.id}`);
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

    // Time Capsule Check
    if (kite.available_after && new Date(kite.available_after) > new Date()) {
      const dateStr = new Date(kite.available_after).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      return res.json({ success: false, correct: 0, message: `This kite is trapped in an updraft. The wind won't let it land until ${dateStr}.` });
    }

    if (kite.expires_at && new Date(kite.expires_at) < new Date()) {
      return res.json({ success: false, correct: 0, message: 'This kite has already come down and is no longer available.' });
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

    // Geolocation and Distance Logic
    const catcherIp = getClientIp(req);
    const catcher_location = await getGeoLocation(catcherIp);
    let flight_distance_km = null;
    
    if (kite.sender_location && catcher_location) {
      flight_distance_km = getDistanceKm(kite.sender_location.lat, kite.sender_location.lon, catcher_location.lat, catcher_location.lon);
    }

    // Mark as caught
    const now = new Date().toISOString();
    await supabase.from('kites').update({ status: 'caught', caught_at: now, catcher_location, flight_distance_km }).eq('id', kite_db_id);

    // Notify sender their kite was caught
    if (kite.sender_email && transporter) {
      await sendCaughtEmail(kite.sender_email, kite.kite_id, kite.beloved_name, catcher_location, flight_distance_km, kite.theme_color);
    }

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
      .select('kite_id, beloved_name, beloved_nickname, status, created_at, caught_at, is_anonymous, theme_color, reply_message, flight_distance_km, sender_location, catcher_location')
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
      caught_at: data.caught_at || null,
      theme_color: data.theme_color,
      reply_message: data.reply_message,
      flight_distance_km: data.flight_distance_km,
      catcher_location: data.catcher_location
    });

  } catch (err) {
    console.error('Ticket error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /api/stats — Get kite statistics
app.get('/api/stats', async (req, res) => {
  try {
    // Trigger background cleanup asynchronously
    cleanupOldKites();

    const stats = await getStats();
    return res.json(stats);
  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /api/download/:kite_id — Download kite as PDF
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

// GET /api/ticket-download/:kite_id — Download tracking ticket as PNG
app.get('/api/ticket-download/:kite_id', async (req, res) => {
  try {
    const { kite_id } = req.params;

    const { data: kite, error } = await supabase
      .from('kites')
      .select('kite_id, beloved_name, beloved_nickname, status, created_at, caught_at, theme_color, reply_message, flight_distance_km, catcher_location')
      .eq('kite_id', kite_id.toUpperCase())
      .single();

    if (error || !kite) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const html = generateKiteTicketHTML(kite);
    res.type('text/html');
    res.send(html);
  } catch (err) {
    console.error('Ticket download error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/reply — Send a breeze back (reply)
app.post('/api/reply', async (req, res) => {
  try {
    const { kite_id, reply_message } = req.body;
    if (!kite_id || !reply_message) return res.status(400).json({ error: 'Missing information.' });

    // Fetch kite data to get sender's email for notification
    const { data: kite, error: fetchError } = await supabase
      .from('kites')
      .select('sender_email, beloved_name, kite_id, theme_color')
      .eq('kite_id', kite_id.toUpperCase())
      .eq('status', 'caught')
      .single();

    if (fetchError) {
      // Log the error but don't block the reply from being saved
      console.error('Reply fetch error:', fetchError);
    }

    const { error: updateError } = await supabase
      .from('kites')
      .update({ reply_message: reply_message.trim() })
      .eq('kite_id', kite_id.toUpperCase())
      .eq('status', 'caught');

    if (updateError) throw updateError;

    // Send notification email
    if (kite && kite.sender_email && transporter) {
      await sendBreezeEmail(kite.sender_email, kite.kite_id, kite.beloved_name, reply_message.trim(), kite.theme_color);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Reply error:', err);
    return res.status(500).json({ error: 'Failed to send reply.' });
  }
});

// GET /api/sky — Get public night sky kites
app.get('/api/sky', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('kites')
      .select('message, theme_color, created_at')
      .eq('is_public', true)
      .limit(30);
    if (error) throw error;
    // Randomize order for a cool aesthetic
    return res.json(data.sort(() => 0.5 - Math.random()));
  } catch (err) {
    return res.status(500).json({ error: 'Could not load the sky.' });
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

// POST /api/report — Submit a report
app.post('/api/report', async (req, res) => {
  try {
    const { kite_id, reporter_email, reason } = req.body;
    if (!kite_id || !reporter_email || !reason) return res.status(400).json({ error: 'Missing required fields.' });

    const ticket_id = 'REP-' + nanoid(8).toUpperCase();
    const { error } = await supabase.from('reports').insert([{
      ticket_id,
      kite_id: kite_id.toUpperCase(),
      reporter_email,
      reason
    }]);

    if (error) throw error;

    if (transporter) {
      await sendReportEmail(reporter_email, ticket_id, kite_id.toUpperCase());
    }

    return res.json({ success: true, ticket_id });
  } catch (err) {
    console.error('Report error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /api/admin/reports — Admin fetch reports
app.get('/api/admin/reports', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    if (auth !== (process.env.ADMIN_SECRET || 'kitemail-admin')) return res.status(401).json({ error: 'Unauthorized' });

    // Fetch reports
    const { data: reports, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    // Manually join kites to avoid Foreign Key relation errors
    if (reports && reports.length > 0) {
      const kiteIds = reports.map(r => r.kite_id);
      const { data: kites } = await supabase
        .from('kites')
        .select('kite_id, sender_ip, message, sender_email, status')
        .in('kite_id', kiteIds);
        
      const kiteMap = {};
      if (kites) kites.forEach(k => kiteMap[k.kite_id] = k);
      reports.forEach(r => { r.kites = kiteMap[r.kite_id] || null; });
    }

    return res.json(reports || []);
  } catch (err) {
    console.error('Reports loading error:', err);
    return res.status(500).json({ error: 'Failed to load reports' });
  }
});

// POST /api/admin/block — Admin block IP
app.post('/api/admin/block', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    if (auth !== (process.env.ADMIN_SECRET || 'kitemail-admin')) return res.status(401).json({ error: 'Unauthorized' });

    const { ip_address, reason } = req.body;
    if (!ip_address) return res.status(400).json({ error: 'IP missing' });

    const { error } = await supabase.from('blocked_ips').insert([{ ip_address, reason }]);
    if (error) throw error;

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to block IP' });
  }
});

// POST /api/admin/resolve — Admin resolve report
app.post('/api/admin/resolve', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    if (auth !== (process.env.ADMIN_SECRET || 'kitemail-admin')) return res.status(401).json({ error: 'Unauthorized' });

    const { report_id, resolution_notes, reporter_email, ticket_id, kite_id } = req.body;
    
    const { error } = await supabase
      .from('reports')
      .update({ status: 'resolved', resolution_notes })
      .eq('id', report_id);

    if (error) throw error;

    if (transporter && reporter_email) {
      await sendResolutionEmail(reporter_email, ticket_id, kite_id, resolution_notes);
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to resolve report' });
  }
});

// Helper: Generate themed, responsive email HTML
function generateEmailHTML({ title, preheader, body, themeColor = 'default' }) {
  const t = getTheme(themeColor);
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  return `
    <!DOCTYPE html>
    <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta name="x-apple-disable-message-reformatting">
      <title>${title}</title>
      <!--[if mso]>
      <noscript>
        <xml>
          <o:OfficeDocumentSettings>
            <o:PixelsPerInch>96</o:PixelsPerInch>
          </o:OfficeDocumentSettings>
        </xml>
      </noscript>
      <![endif]-->
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400&family=Outfit:wght@300;400;500&display=swap');
        table, td, div, h1, p {font-family: 'Outfit', sans-serif;}
        body { margin: 0; padding: 0; background-color: ${t.bg}; }
        .content-wrapper { background-color: #ffffff; padding: 32px; border: 1px solid #e8f0f6; border-radius: 12px; }
        h1 { color: ${t.primary}; font-family: 'Bodoni Moda', Georgia, serif; font-size: 28px; margin: 0 0 16px; font-weight: 400; }
        p { color: #4a5668; font-size: 15px; line-height: 1.7; margin: 0 0 16px; }
        strong { color: #1e2532; }
        a.button { display: inline-block; padding: 12px 24px; background-color: ${t.primary}; color: #ffffff !important; text-decoration: none; border-radius: 20px; font-family: 'Outfit', sans-serif; font-size: 13px; }
        .footer p { color: #798699; font-size: 12px; margin: 0 0 4px; }
        .footer a { color: #798699; text-decoration: underline; }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: ${t.bg};">
      <div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
        ${preheader}
      </div>
      <table role="presentation" style="width:100%;border-collapse:collapse;border:0;border-spacing:0;background:${t.bg};">
        <tr>
          <td align="center" style="padding:24px 12px;">
            <table role="presentation" style="width:100%;max-width:560px;border-collapse:collapse;border:0;border-spacing:0;">
              <tr>
                <td align="center" style="padding:20px 0;">
                  <a href="${appUrl}" style="font-family: 'Bodoni Moda', Georgia, serif; font-size: 22px; font-weight: 400; color: #1e2532; text-decoration: none;">
                    🪁 Kite<span style="color: ${t.primary};">Mail</span>
                  </a>
                </td>
              </tr>
              <tr>
                <td class="content-wrapper" style="background-color: #ffffff; padding: 32px; border: 1px solid #e8f0f6; border-radius: 12px;">
                  ${body}
                </td>
              </tr>
              <tr>
                <td align="center" class="footer" style="padding:24px 12px;">
                  <p>KiteMail — Messages carried by the wind</p>
                  <p><a href="${appUrl}/about">About</a> &bull; <a href="${appUrl}/safety">Safety</a> &bull; <a href="${appUrl}/ticket">Track Kite</a></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

// ─── EMAIL ────────────────────────────────────────────────────────────────────

async function sendTicketEmail(email, kite_id, beloved_name, theme_color = 'default') {
  try {
    const body = `
      <h1>🪁 Your kite is in the sky</h1>
      <p>Flying towards <strong>${beloved_name}</strong></p>
      <div style="background: #f2f7fa; border: 1px solid #e8f0f6; border-radius: 8px; padding: 24px; margin-bottom: 32px; text-align: center;">
        <p style="color: #4a5668; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 8px;">Kite ID</p>
        <p style="color: ${getTheme(theme_color).primary}; font-size: 28px; font-family: monospace; letter-spacing: 4px; margin: 0;">${kite_id}</p>
      </div>
      <p>Use this ID anytime to check if your kite has been caught. Keep it safe — this is your only proof that your kite is flying.</p>
      <p style="text-align: center; margin: 32px 0 0;"><a href="${process.env.APP_URL}/ticket?id=${kite_id}" class="button">Track Your Kite</a></p>
    `;

    await transporter.sendMail({
      from: `KiteMail <${process.env.SMTP_FROM}>`,
      to: email,
      subject: `Your kite is flying 🪁 — ${kite_id}`,
      html: generateEmailHTML({
        title: `Your kite is flying 🪁 — ${kite_id}`,
        preheader: `Your Kite ID is ${kite_id}. Keep it safe to track your message.`,
        body,
        themeColor: theme_color
      })
    });
  } catch (e) {
    console.error('Email send error:', e);
  }
}

async function sendCaughtEmail(email, kite_id, beloved_name, catcher_location, distance_km, theme_color = 'default') {
  try {
    let geoText = '';
    if (catcher_location && catcher_location.city) {
      geoText = `<p>It was caught in <strong>${catcher_location.city}, ${catcher_location.country}</strong>.</p>`;
    }
    if (distance_km) {
      geoText += `<p>Your kite flew <strong>${distance_km} km</strong> to reach them.</p>`;
    }

    const body = `
      <h1>💌 They caught it.</h1>
      <p><strong>${beloved_name}</strong> successfully answered your security questions and opened your kite.</p>
      ${geoText}
      <p style="text-align: center; margin: 24px 0 0;"><a href="${process.env.APP_URL}/ticket?id=${kite_id}" class="button">View Ticket Status</a></p>
    `;

    await transporter.sendMail({
      from: `KiteMail <${process.env.SMTP_FROM}>`,
      to: email,
      subject: `💌 Your kite was caught! — ${kite_id}`,
      html: generateEmailHTML({
        title: `Your kite was caught! — ${kite_id}`,
        preheader: `${beloved_name} has caught and read your kite message.`,
        body,
        themeColor: theme_color
      })
    });
  } catch (e) { console.error('Caught Email send error:', e); }
}

async function sendBreezeEmail(email, kite_id, beloved_name, reply_message, theme_color = 'default') {
  try {
    const body = `
      <h1>🌬️ A breeze came back for you.</h1>
      <p><strong>${beloved_name}</strong> sent a reply to your kite message.</p>
      <div style="background: #f2f7fa; border: 1px solid #e8f0f6; border-radius: 8px; padding: 24px; margin: 24px 0; font-style: italic;">
        "${reply_message}"
      </div>
      <p style="text-align: center; margin: 24px 0 0;"><a href="${process.env.APP_URL}/ticket?id=${kite_id}" class="button">View Full Ticket</a></p>
    `;

    await transporter.sendMail({
      from: `KiteMail <${process.env.SMTP_FROM}>`,
      to: email,
      subject: `🌬️ A breeze came back for kite ${kite_id}`,
      html: generateEmailHTML({
        title: `A breeze came back for you`,
        preheader: `${beloved_name} has replied to your kite message.`,
        body,
        themeColor: theme_color
      })
    });
  } catch (e) {
    console.error('Breeze Email send error:', e);
  }
}

async function sendReportEmail(email, ticket_id, kite_id) {
  try {
    const body = `
      <h1>🚨 Report Received</h1>
      <p>We have received your report regarding Kite <strong>${kite_id}</strong>.</p>
      <div style="background: #f2f7fa; border: 1px solid #e8f0f6; border-radius: 8px; padding: 24px; margin-bottom: 32px; text-align: center;">
        <p style="color: #4a5668; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 8px;">Report Ticket ID</p>
        <p style="color: ${getTheme('default').primary}; font-size: 28px; font-family: monospace; letter-spacing: 4px; margin: 0;">${ticket_id}</p>
      </div>
      <p>Our admin team will review this shortly.</p>
    `;

    await transporter.sendMail({
      from: `"Admin (Kite Mail)" <kitemailspace@gmail.com>`,
      to: email,
      subject: `Report Received — ${ticket_id}`,
      html: generateEmailHTML({
        title: `Report Received`,
        preheader: `Your report ticket ID is ${ticket_id}.`,
        body,
        themeColor: 'default'
      })
    });
  } catch (e) { console.error('Report Email send error:', e); }
}

async function sendResolutionEmail(email, ticket_id, kite_id, resolution_notes) {
  try {
    const body = `
      <h1>✅ Report Resolved</h1>
      <p>Your report <strong>${ticket_id}</strong> regarding Kite <strong>${kite_id}</strong> has been resolved by our admin team.</p>
      <div style="background: #f2f7fa; border: 1px solid #e8f0f6; border-radius: 8px; padding: 24px; margin: 24px 0; font-style: italic;">
        "<strong>Admin Note:</strong> ${resolution_notes}"
      </div>
      <p>Thank you for helping keep the sky safe.</p>
    `;

    await transporter.sendMail({
      from: `"Admin (Kite Mail)" <kitemailspace@gmail.com>`,
      to: email,
      subject: `Report Resolved — ${ticket_id}`,
      html: generateEmailHTML({
        title: `Report Resolved`,
        preheader: `Update on your report for kite ${kite_id}.`,
        body,
        themeColor: 'default'
      })
    });
  } catch (e) { console.error('Resolution Email send error:', e); }
}

// ─── PAGE ROUTES ──────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/fly', (req, res) => res.sendFile(path.join(__dirname, 'public', 'fly.html')));
app.get('/find', (req, res) => res.sendFile(path.join(__dirname, 'public', 'find.html')));
app.get('/ticket', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ticket.html')));
app.get('/sky', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sky.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
app.get('/safety', (req, res) => res.sendFile(path.join(__dirname, 'public', 'safety.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/report', (req, res) => res.sendFile(path.join(__dirname, 'public', 'report.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => {
  console.log(`🪁 KiteMail running on http://localhost:${PORT}`);
});

module.exports = app;
