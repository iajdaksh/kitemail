require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
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

// Helper: Get current stats
async function getStats() {
  try {
    const { data, error } = await supabase.from('stats').select('total_kites_flied, total_kites_caught').eq('id', 1).single();
    if (error) throw error;
    return data;
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
          Dear <strong>${kite.beloved_name}</strong>,
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
      status: 'flying'
    };

    const { data, error } = await supabase.from('kites').insert([insertData]).select('kite_id').single();

    if (error) throw error;

    // Send ticket email if email provided
    if (sender_email && transporter) {
      await sendTicketEmail(sender_email, kite_id, beloved_name);
    }

    // Increment total kites flied counter
    try {
      await supabase.rpc('increment_kites_flied');
    } catch (err) {
      console.error('Error incrementing kites flied:', err);
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

    let query = supabase
      .from('kites')
      .select('id, kite_id, question_1, hint_1, question_2, hint_2, question_3, hint_3, created_at, status, is_anonymous, sender_name, sender_nickname, sender_dob, is_deleted')
      .ilike('beloved_name', beloved_name.trim())
      .ilike('beloved_nickname', beloved_nickname.trim())
      .eq('beloved_dob', beloved_dob.trim())
      .eq('status', 'flying');

    // If sender_dob filter provided
    if (sender_dob && sender_dob.trim()) {
      query = query.eq('sender_dob', sender_dob.trim());
    }

    const { data, error } = await query;
    if (error) throw error;

    // Filter out deleted kites
    const activeKites = data?.filter(k => !k.is_deleted) || [];

    if (!activeKites || activeKites.length === 0) {
      return res.json({ found: false, kites: [] });
    }

    // Return kites without sensitive data
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

    return res.json({ found: true, kites, multiple: kites.length > 1 });

  } catch (err) {
    console.error('Find error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
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

    // Increment total kites caught counter
    try {
      await supabase.rpc('increment_kites_caught');
    } catch (err) {
      console.error('Error incrementing kites caught:', err);
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
