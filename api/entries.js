import { ObjectId } from 'mongodb';
import { getDb } from './_db.js';

const VALID_TYPES = ['artist', 'influencer'];

function cleanUsername(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '') // drop leading @ symbols
    .trim();
}

export default async function handler(req, res) {
  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error('DB connection error:', err);
    return res.status(500).json({ error: 'Could not connect to the database.' });
  }

  const col = db.collection('entries');

  try {
    // ---- List all entries -------------------------------------------------
    if (req.method === 'GET') {
      const entries = await col.find({}).sort({ createdAt: -1 }).toArray();
      return res.status(200).json({ entries });
    }

    // ---- Add a new entry --------------------------------------------------
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const username = cleanUsername(body.username);
      const type = String(body.type || '').toLowerCase();

      if (!username) {
        return res.status(400).json({ error: 'Username is required.' });
      }
      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: 'Type must be "artist" or "influencer".' });
      }

      const usernameLower = username.toLowerCase();

      // Global duplicate check (case-insensitive, across both categories).
      const existing = await col.findOne({ usernameLower });
      if (existing) {
        return res.status(409).json({
          error: `"${username}" is already in the list as a${
            existing.type === 'artist' ? 'n Artist' : ' Influencer'
          }.`,
        });
      }

      const doc = {
        username,
        usernameLower,
        type,
        createdAt: new Date().toISOString(),
      };

      try {
        const result = await col.insertOne(doc);
        return res.status(201).json({ entry: { _id: result.insertedId, ...doc } });
      } catch (err) {
        // Unique-index race: someone inserted the same name a moment ago.
        if (err && err.code === 11000) {
          const clash = await col.findOne({ usernameLower });
          const asType = clash
            ? ` as a${clash.type === 'artist' ? 'n Artist' : ' Influencer'}`
            : '';
          return res.status(409).json({ error: `"${username}" is already in the list${asType}.` });
        }
        throw err;
      }
    }

    // ---- Delete an entry --------------------------------------------------
    if (req.method === 'DELETE') {
      const id = req.query?.id;
      if (!id || !ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'A valid entry id is required.' });
      }
      const result = await col.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Entry not found.' });
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('Request error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
