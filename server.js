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
      .select('id, kite_id, question_1, hint_1, question_2, hint_2, question_3, hint_3, created_at, status, is_anonymous, sender_name, sender_nickname, sender_dob')
      .ilike('beloved_name', beloved_name.trim())
      .ilike('beloved_nickname', beloved_nickname.trim())
      .eq('beloved_dob', beloved_dob.trim());

    // If sender_dob filter provided
    if (sender_dob && sender_dob.trim()) {
      query = query.eq('sender_dob', sender_dob.trim());
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.json({ found: false, kites: [] });
    }

    // Return kites without sensitive data
    const kites = data.map(k => ({
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
