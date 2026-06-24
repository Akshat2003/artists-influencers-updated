# Underdawg · Username Collector

A clean, mobile-responsive web app for collecting **Artist** and **Influencer**
usernames into MongoDB, with global duplicate checking and one-click **CSV export**.

Built with **React + Vite** for the UI and **Vercel Serverless Functions** for a
thin, secure API layer that talks to MongoDB. Your database credentials live only
on the server (as an environment variable) — they are **never** shipped to the browser.

> **Why not pure frontend?** A browser can't speak MongoDB's wire protocol, and
> putting the connection string in frontend code would expose your DB password to
> anyone who opens the site. The tiny `/api` layer keeps it secure while still
> being a single project your teammate just opens as a website.

---

## Features

- ✍️ Two inputs: **Artist username** and **Influencer username**
- 🔁 **Global duplicate check** (case-insensitive) — a username can only appear once, in either category
- 💾 Stored centrally in **MongoDB** (shared across everyone, every device)
- 📤 **Export all entries to CSV** with one click
- 🔍 Search + filter (All / Artists / Influencers) and live counts
- 🗑️ Remove entries (handy for typos)
- 📱 Fully **mobile responsive**, attractive and professional UI

---

## Project structure

```
.
├── api/
│   ├── _db.js         # cached MongoDB connection + unique index
│   └── entries.js     # GET (list) / POST (add) / DELETE serverless function
├── src/
│   ├── App.jsx        # all UI + logic
│   ├── App.css        # styling
│   ├── index.css      # theme tokens / base
│   └── main.jsx
├── public/favicon.svg
├── index.html
├── package.json
├── vite.config.js
├── .env.example
└── README.md
```

---

## 1) Local development

```bash
npm install
```

Create a `.env` file (copy from `.env.example`) with your connection string:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=underdawg
```

The UI runs with Vite, but the `/api` functions need the Vercel runtime, so the
easiest way to run the **whole thing** locally is:

```bash
npm install -g vercel      # one-time
vercel dev                 # runs UI + /api together at http://localhost:3000
```

(`npm run dev` alone serves only the UI without the API.)

---

## 2) Deploy to Vercel (recommended)

1. Push this folder to a GitHub repo (or run `vercel` from the folder).
2. In the [Vercel dashboard](https://vercel.com/new), import the project.
3. Go to **Settings → Environment Variables** and add:
   - `MONGODB_URI` → your connection string
   - `MONGODB_DB` → `underdawg`
4. Click **Deploy**. You'll get a public URL like `https://underdawg.vercel.app`.
5. Share that URL with your teammate — they just open it and start adding usernames.

> ⚠️ **MongoDB Atlas Network Access:** make sure Atlas allows connections from
> Vercel. In Atlas → **Network Access**, add `0.0.0.0/0` (allow from anywhere),
> since serverless functions use dynamic IPs.

---

## CSV format

`underdawg-usernames-YYYY-MM-DD.csv`

| Username | Type | Added At |
|----------|------|----------|
| taylorswift | artist | 2026-06-10T... |
| mrbeast | influencer | 2026-06-10T... |

---

## Security note

`.env.example` and this README now use **placeholders only** — never commit a real
connection string or access token. `.env` is git-ignored; keep real secrets there
locally and in the Vercel dashboard (Settings → Environment Variables).

> ⚠️ A real MongoDB connection string was previously committed in `.env.example`
> (now scrubbed). Scrubbing the file does **not** remove it from git history, and
> **anyone with that string has full read/write/delete access to the database.**
> You should:
> 1. **Rotate the MongoDB password** in Atlas (Database Access → Edit user) and
>    update `MONGODB_URI` locally + in Vercel.
> 2. Treat the previously-committed `IG_TOKEN`, if any, the same way (rotate it).
> 3. Optionally purge the secret from git history (e.g. `git filter-repo`) before
>    sharing the repo.
