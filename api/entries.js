import { ObjectId } from 'mongodb';
import { getDb } from './_db.js';
import { fetchBusinessDiscovery, computeMetrics, inferCategory } from './_ig.js';
import { getSessionUser, ensureSeedAdmin, can } from './_auth.js';

// Fields returned to users WITHOUT the view_metrics permission — enough for the
// add form, client-side dedup, and the daily tier counters; no enriched data.
const MINIMAL_PROJECTION = {
  username: 1, usernameLower: 1, type: 1, createdAt: 1,
  enrichStatus: 1, 'metrics.followerTier': 1,
};

const VALID_TYPES = ['artist', 'influencer'];

function cleanUsername(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '') // drop leading @ symbols
    .trim();
}

// Fetch the Instagram profile and compute the enrichment fields for an entry.
// Always resolves (never throws); the returned $set object reflects the outcome
// via enrichStatus. Exported so the /api/enrich backfill endpoint can reuse it.
export async function buildEnrichment(username, type) {
  const result = await fetchBusinessDiscovery(username);
  const now = new Date().toISOString();

  if (result.status === 'ok') {
    const metrics = computeMetrics(result.raw);
    const inferred = inferCategory(result.raw, metrics, type);
    return {
      enrichStatus: 'ok',
      enrichedAt: now,
      enrichError: null,
      raw: result.raw,
      metrics,
      inferredType: inferred.inferredType,
      categoryMismatch: inferred.categoryMismatch,
      inferReason: inferred.inferReason,
      inferScore: inferred.inferScore,
    };
  }

  // not ok -> store status + error, no metrics; clear any stale enrichment
  return {
    enrichStatus: result.status, // 'pending' | 'undiscoverable' | 'error'
    enrichedAt: result.status === 'undiscoverable' ? now : null,
    enrichError: result.error,
    raw: null,
    metrics: null,
    inferredType: null,
    categoryMismatch: false,
    inferReason: null,
    inferScore: null,
  };
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

  // ---- authentication ----
  await ensureSeedAdmin(db);
  const me = await getSessionUser(req, db);
  if (!me) return res.status(401).json({ error: 'Not signed in.' });

  try {
    // ---- List entries (projection depends on view_metrics) ----------------
    if (req.method === 'GET') {
      const full = can(me, 'view_metrics');
      const cursor = col.find({}, full ? {} : { projection: MINIMAL_PROJECTION });
      const entries = await cursor.sort({ createdAt: -1 }).toArray();
      return res.status(200).json({ entries });
    }

    // ---- Add a new entry --------------------------------------------------
    if (req.method === 'POST') {
      if (!can(me, 'add_entries')) return res.status(403).json({ error: 'Not allowed to add entries.' });
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

      // Enrich synchronously from the Instagram Graph API. This never throws —
      // on rate-limit/failure the entry is still saved (enrichStatus reflects it)
      // and can be re-enriched later via /api/enrich.
      const enrichment = await buildEnrichment(username, type);

      const doc = {
        username,
        usernameLower,
        type,
        createdAt: new Date().toISOString(),
        enrichAttempts: 1,
        ...enrichment,
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
      if (!can(me, 'delete_entries')) return res.status(403).json({ error: 'Not allowed to delete entries.' });
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
