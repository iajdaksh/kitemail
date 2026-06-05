# 🪁 KiteMail

> *Messages carried by the wind — meant only for someone who knows to look up.*

A romantic, anonymous messaging platform where you send a secret "kite" to someone using only their name, nickname, and birthday. They catch it by answering 3 personal questions only they would know.

---

## Features

- 🪁 **Fly a Kite** — Write a message for someone special, protected by 3 personal security questions
- 🔍 **Find a Kite** — Search by your name + nickname + birthday to see if someone flew a kite your way
- 🎭 **Anonymous mode** — Send without revealing your identity
- 🎫 **Kite Tracker** — Track if your kite has been caught, with date/time
- 🔐 **2-of-3 security** — Recipient must answer 2 of 3 questions correctly to unlock the message
- 📧 **Optional email** — Get your Kite ID delivered to your inbox

---

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** Supabase (PostgreSQL)
- **Hosting:** Vercel
- **Frontend:** Vanilla HTML/CSS/JS (no framework, no bundler needed)

---

## Setup

### 1. Clone & Install

```bash
git clone <your-repo>
cd kitemail
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the contents of `supabase-schema.sql`
3. Copy your **Project URL**, **anon key**, and **service role key** from Project Settings → API

### 3. Configure Environment

```bash
cp .env.example .env
```

Fill in your `.env`:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
APP_URL=http://localhost:3000
PORT=3000

# Optional - for email ticket delivery
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=noreply@kitemail.app
```

### 4. Run Locally

```bash
npm run dev
```

Visit `http://localhost:3000`

---

## Deploy to Vercel

### Option A — Vercel CLI

```bash
npm i -g vercel
vercel
```

### Option B — GitHub Integration

1. Push to GitHub
2. Import repo in [vercel.com/new](https://vercel.com/new)
3. Add all environment variables in Vercel dashboard → Settings → Environment Variables
4. Deploy ✓

---

## Project Structure

```
kitemail/
├── server.js              # Main Express server + all API routes
├── package.json
├── vercel.json            # Vercel deployment config
├── supabase-schema.sql    # Run this in Supabase SQL editor
├── .env.example           # Copy to .env and fill in
└── public/
    ├── index.html         # Hero homepage
    ├── fly.html           # Send a kite
    ├── find.html          # Find & catch a kite
    ├── ticket.html        # Track kite status
    ├── about.html         # About page
    ├── safety.html        # Safety guidelines
    ├── terms.html         # Terms of use
    ├── privacy.html       # Privacy policy
    ├── 404.html           # 404 page
    ├── css/
    │   └── main.css       # All styles (dark dreamy theme)
    └── js/
        └── app.js         # Shared JS utilities
```

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/fly` | Send a new kite |
| POST | `/api/find` | Search for kites by beloved details |
| POST | `/api/catch` | Attempt to catch a kite (answer questions) |
| GET | `/api/ticket/:kite_id` | Get kite status by ticket ID |

---

## Security Notes

- Security question answers are stored normalized (lowercase + trimmed) — not exact plaintext
- Sender's DOB is stored but never shown to the recipient
- Anonymous mode hides all sender details completely
- Row Level Security (RLS) is enabled on the Supabase table

---

## License

MIT — build on it, remix it, send someone a kite 🪁
