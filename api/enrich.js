import { ObjectId } from 'mongodb';
import { getDb } from './_db.js';
import { buildEnrichment } from './entries.js';
import { getSessionUser, ensureSeedAdmin, can, isServiceCall } from './_auth.js';

// Re-enrich / backfill endpoint.
//   POST /api/enrich?id=<entryId>      -> re-enrich a single entry (retry button)
//   POST /api/enrich?all=1&limit=N     -> backfill un-enriched entries (N<=50),
//                                          throttled, stops on rate limit.
//
// Never auto-runs on GET — call it explicitly so page views don't burn the
// Instagram hourly rate limit.

const THROTTLE_MS = 350;
const MAX_LIMIT = 50;

// entries that still need enrichment: never enriched, or left pending/error
const NEEDS_ENRICH = {
  $or: [
    { enrichStatus: { $exists: false } },
    { enrichStatus: { $in: ['pending', 'error'] } },
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error('DB connection error:', err);
    return res.status(500).json({ error: 'Could not connect to the database.' });
  }

  // Allow an internal service token (backfill loop / cron) or a signed-in user
  // with the refresh_metrics permission.
  if (!isServiceCall(req)) {
    await ensureSeedAdmin(db);
    const me = await getSessionUser(req, db);
    if (!me) return res.status(401).json({ error: 'Not signed in.' });
    if (!can(me, 'refresh_metrics')) return res.status(403).json({ error: 'Not allowed.' });
  }

  const col = db.collection('entries');
  const id = req.query?.id;
  const all = req.query?.all;

  try {
    // ---- single entry ----------------------------------------------------
    if (id) {
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'A valid entry id is required.' });
      }
      const entry = await col.findOne({ _id: new ObjectId(id) });
      if (!entry) return res.status(404).json({ error: 'Entry not found.' });

      const enrichment = await buildEnrichment(entry.username, entry.type);
      await col.updateOne(
        { _id: entry._id },
        { $set: enrichment, $inc: { enrichAttempts: 1 } }
      );
      return res.status(200).json({
        ok: true,
        id,
        enrichStatus: enrichment.enrichStatus,
        enrichError: enrichment.enrichError,
        rateLimited: enrichment.enrichError === 'rate_limited',
        tokenInvalid: String(enrichment.enrichError || '').startsWith('auth_error'),
      });
    }

    // ---- bulk backfill ---------------------------------------------------
    if (all) {
      const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query?.limit, 10) || MAX_LIMIT));
      const batch = await col
        .find(NEEDS_ENRICH)
        .sort({ createdAt: 1 })
        .limit(limit)
        .toArray();

      let updated = 0;
      let rateLimited = false;
      let tokenInvalid = false;
      const results = [];

      for (let i = 0; i < batch.length; i++) {
        const entry = batch[i];
        const enrichment = await buildEnrichment(entry.username, entry.type);

        // Stop the whole run on a rate limit — the window won't reopen mid-batch.
        if (enrichment.enrichError === 'rate_limited') {
          rateLimited = true;
          break;
        }
        if (String(enrichment.enrichError || '').startsWith('auth_error')) {
          tokenInvalid = true;
        }

        await col.updateOne(
          { _id: entry._id },
          { $set: enrichment, $inc: { enrichAttempts: 1 } }
        );
        updated += 1;
        results.push({
          id: String(entry._id),
          username: entry.username,
          enrichStatus: enrichment.enrichStatus,
        });

        if (tokenInvalid) break; // token broken -> no point continuing
        if (i < batch.length - 1) await sleep(THROTTLE_MS);
      }

      const remaining = await col.countDocuments(NEEDS_ENRICH);
      return res.status(200).json({
        ok: true,
        updated,
        remaining,
        rateLimited,
        tokenInvalid,
        results,
      });
    }

    return res.status(400).json({ error: 'Provide ?id=<entryId> or ?all=1.' });
  } catch (err) {
    console.error('Enrich error:', err);
    return res.status(500).json({ error: 'Something went wrong during enrichment.' });
  }
}
