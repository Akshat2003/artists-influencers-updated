// Authentication + authorization helpers.
//  - Passwords: bcrypt-hashed (bcryptjs, pure JS).
//  - Sessions: HMAC-signed token in an HttpOnly cookie (no server state).
//  - Authorization: per-user permission flags (see PERMISSION_KEYS).
//
// Server-only env:
//   SESSION_SECRET   secret for signing session cookies (required in prod)
//   ADMIN_USER       seed admin username   (created on first run)
//   ADMIN_PASSWORD   seed admin password
//   SERVICE_TOKEN    optional shared token for internal callers (e.g. backfill)

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';

export const COOKIE_NAME = 'uw_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// All capabilities an account can be granted.
export const PERMISSION_KEYS = [
  'add_entries',     // add artist/influencer usernames
  'view_list',       // see the username list ONLY (no metrics/analytics)
  'view_metrics',    // see the enriched list + metrics, flags, detail panels
  'export',          // export CSV
  'delete_entries',  // remove entries
  'refresh_metrics', // run the enrich/backfill
  'manage_users',    // create/modify/delete users (admin)
];

export const PERMISSION_LABELS = {
  add_entries: 'Add usernames',
  view_list: 'View username list',
  view_metrics: 'View metrics & analytics',
  export: 'Export CSV',
  delete_entries: 'Delete entries',
  refresh_metrics: 'Refresh metrics',
  manage_users: 'Manage users',
};

export function allPermissions(value = true) {
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, value]));
}

// Keep only known keys, coerce to boolean.
export function normalizePermissions(input) {
  const out = allPermissions(false);
  if (input && typeof input === 'object') {
    for (const k of PERMISSION_KEYS) out[k] = input[k] === true;
  }
  return out;
}

function secret() {
  return process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
}

// ---- password ----
export function hashPassword(pw) {
  return bcrypt.hashSync(String(pw), 10);
}
export function verifyPassword(pw, hash) {
  try {
    return bcrypt.compareSync(String(pw), String(hash));
  } catch {
    return false;
  }
}

// ---- signed session token: base64url(payload).hmac ----
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signSession(uid) {
  const payload = b64url(JSON.stringify({ uid, exp: Date.now() + SESSION_TTL_MS }));
  const sig = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  return `${payload}.${sig}`;
}
function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data; // { uid, exp }
  } catch {
    return null;
  }
}

// ---- cookies ----
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function sessionCookie(uid) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return `${COOKIE_NAME}=${signSession(uid)}; HttpOnly;${secure} Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}
export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

// ---- current user ----
// Returns the authenticated user document (without passwordHash) or null.
export async function getSessionUser(req, db) {
  const cookies = parseCookies(req.headers?.cookie);
  const data = verifySessionToken(cookies[COOKIE_NAME]);
  if (!data) return null;
  let user;
  try {
    user = await db.collection('users').findOne({ _id: new ObjectId(data.uid) });
  } catch {
    return null;
  }
  if (!user) return null;
  return publicUser(user);
}

export function publicUser(u) {
  return {
    _id: String(u._id),
    username: u.username,
    permissions: normalizePermissions(u.permissions),
    createdAt: u.createdAt,
  };
}

export function can(user, key) {
  return !!(user && user.permissions && user.permissions[key] === true);
}

// Internal callers (backfill loop / cron) may pass a shared service token.
export function isServiceCall(req) {
  const t = process.env.SERVICE_TOKEN;
  return !!t && req.headers?.['x-service-token'] === t;
}

// ---- seed admin (idempotent, once per warm instance) ----
let seeded = false;
export async function ensureSeedAdmin(db) {
  if (seeded) return;
  seeded = true;
  const username = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  const usernameLower = username.trim().toLowerCase();
  const users = db.collection('users');
  const existing = await users.findOne({ usernameLower });
  if (existing) return;
  await users.insertOne({
    username: username.trim(),
    usernameLower,
    passwordHash: hashPassword(password),
    permissions: allPermissions(true),
    createdAt: new Date().toISOString(),
    createdBy: 'seed',
  });
  // eslint-disable-next-line no-console
  console.log(`[auth] seeded admin user "${username.trim()}"`);
}
