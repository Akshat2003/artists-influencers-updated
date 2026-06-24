import { getDb } from './_db.js';
import {
  getSessionUser, ensureSeedAdmin, verifyPassword, publicUser,
  sessionCookie, clearCookie,
} from './_auth.js';

// Authentication endpoint.
//   GET    /api/auth   -> { user }  (current session, or null)
//   POST   /api/auth   -> login { username, password } -> sets cookie, { user }
//   DELETE /api/auth   -> logout (clears cookie)
export default async function handler(req, res) {
  let db;
  try {
    db = await getDb();
    await ensureSeedAdmin(db);
  } catch (err) {
    console.error('DB connection error:', err);
    return res.status(500).json({ error: 'Could not connect to the database.' });
  }
  const users = db.collection('users');

  try {
    if (req.method === 'GET') {
      const user = await getSessionUser(req, db);
      return res.status(200).json({ user: user || null });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }
      const user = await users.findOne({ usernameLower: username.toLowerCase() });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }
      res.setHeader('Set-Cookie', sessionCookie(String(user._id)));
      return res.status(200).json({ user: publicUser(user) });
    }

    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', clearCookie());
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}
