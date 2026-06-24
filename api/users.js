import { ObjectId } from 'mongodb';
import { getDb } from './_db.js';
import {
  getSessionUser, ensureSeedAdmin, can, publicUser,
  hashPassword, normalizePermissions,
} from './_auth.js';

// User management (admin only — requires the `manage_users` permission).
//   GET    /api/users           -> { users: [...] }
//   POST   /api/users           -> create { username, password, permissions } -> { user }
//   PATCH  /api/users?id=<id>    -> modify  { permissions?, password? } -> { user }
//   DELETE /api/users?id=<id>    -> delete
export default async function handler(req, res) {
  let db;
  try {
    db = await getDb();
    await ensureSeedAdmin(db);
  } catch (err) {
    console.error('DB connection error:', err);
    return res.status(500).json({ error: 'Could not connect to the database.' });
  }

  const me = await getSessionUser(req, db);
  if (!me) return res.status(401).json({ error: 'Not signed in.' });
  if (!can(me, 'manage_users')) return res.status(403).json({ error: 'Not allowed.' });

  const users = db.collection('users');
  const id = req.query?.id;
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

  // count remaining admins if a given user loses manage_users / is removed
  async function adminCountExcluding(userId, willStillBeAdmin) {
    const admins = await users.find({ 'permissions.manage_users': true }).toArray();
    return admins.filter((u) => (String(u._id) === String(userId) ? willStillBeAdmin : true)).length;
  }

  try {
    if (req.method === 'GET') {
      const list = await users.find({}).sort({ createdAt: 1 }).toArray();
      return res.status(200).json({ users: list.map(publicUser) });
    }

    if (req.method === 'POST') {
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      }
      const usernameLower = username.toLowerCase();
      if (await users.findOne({ usernameLower })) {
        return res.status(409).json({ error: `User "${username}" already exists.` });
      }
      const doc = {
        username,
        usernameLower,
        passwordHash: hashPassword(password),
        permissions: normalizePermissions(body.permissions),
        createdAt: new Date().toISOString(),
        createdBy: me.username,
      };
      const r = await users.insertOne(doc);
      return res.status(201).json({ user: publicUser({ _id: r.insertedId, ...doc }) });
    }

    if (req.method === 'PATCH') {
      if (!id || !ObjectId.isValid(id)) return res.status(400).json({ error: 'Valid id required.' });
      const target = await users.findOne({ _id: new ObjectId(id) });
      if (!target) return res.status(404).json({ error: 'User not found.' });

      const set = {};
      if (body.permissions) {
        const perms = normalizePermissions(body.permissions);
        // don't allow removing the last admin's manage_users
        if (!perms.manage_users && (await adminCountExcluding(id, false)) === 0) {
          return res.status(400).json({ error: 'At least one admin must keep “Manage users”.' });
        }
        set.permissions = perms;
      }
      if (body.password) {
        if (String(body.password).length < 6) {
          return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        }
        set.passwordHash = hashPassword(body.password);
      }
      if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to update.' });

      await users.updateOne({ _id: target._id }, { $set: set });
      const updated = await users.findOne({ _id: target._id });
      return res.status(200).json({ user: publicUser(updated) });
    }

    if (req.method === 'DELETE') {
      if (!id || !ObjectId.isValid(id)) return res.status(400).json({ error: 'Valid id required.' });
      if (String(me._id) === String(id)) {
        return res.status(400).json({ error: 'You cannot delete your own account.' });
      }
      const target = await users.findOne({ _id: new ObjectId(id) });
      if (!target) return res.status(404).json({ error: 'User not found.' });
      if (target.permissions?.manage_users && (await adminCountExcluding(id, false)) === 0) {
        return res.status(400).json({ error: 'Cannot delete the last admin.' });
      }
      await users.deleteOne({ _id: target._id });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('Users error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}
