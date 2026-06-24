import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const API = '/api/entries';
const ENRICH_API = '/api/enrich';
const AUTH_API = '/api/auth';
const USERS_API = '/api/users';
const DAILY_TIER_GOAL = 15; // target entries per type, per tier, per day

const TIERS = ['nano', 'micro', 'mid', 'mega'];
const TIER_META = {
  nano: { label: 'Nano', sub: '<15k' },
  micro: { label: 'Micro', sub: '15k–100k' },
  mid: { label: 'Mid', sub: '100k–1M' },
  mega: { label: 'Mega', sub: '>1M' },
};

const PERMISSION_KEYS = [
  'add_entries', 'view_list', 'view_metrics', 'export', 'delete_entries', 'refresh_metrics', 'manage_users',
];
const PERMISSION_LABELS = {
  add_entries: 'Add usernames',
  view_list: 'View username list',
  view_metrics: 'View metrics & analytics',
  export: 'Export CSV',
  delete_entries: 'Delete entries',
  refresh_metrics: 'Refresh metrics',
  manage_users: 'Manage users',
};

function can(user, key) {
  return !!(user && user.permissions && user.permissions[key] === true);
}

/* ===================================================================== */
/* Root: auth gate                                                       */
/* ===================================================================== */
export default function App() {
  const [authState, setAuthState] = useState('loading'); // loading | out | in
  const [user, setUser] = useState(null);
  const [view, setView] = useState('collect'); // collect | users
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  function showToast(type, message) {
    setToast({ type, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(AUTH_API);
        const data = await res.json();
        if (data.user) { setUser(data.user); setAuthState('in'); }
        else setAuthState('out');
      } catch {
        setAuthState('out');
      }
    })();
    return () => toastTimer.current && clearTimeout(toastTimer.current);
  }, []);

  async function logout() {
    try { await fetch(AUTH_API, { method: 'DELETE' }); } catch { /* ignore */ }
    setUser(null);
    setView('collect');
    setAuthState('out');
  }

  if (authState === 'loading') {
    return <div className="boot"><span className="spinner dark" /> Loading…</div>;
  }
  if (authState === 'out') {
    return <Login onLogin={(u) => { setUser(u); setAuthState('in'); }} />;
  }

  return (
    <Shell user={user} view={view} setView={setView} onLogout={logout}>
      {view === 'users' && can(user, 'manage_users')
        ? <UsersView me={user} showToast={showToast} />
        : <CollectView user={user} showToast={showToast} />}
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          {toast.type === 'success' ? <CheckIcon /> : <AlertIcon />}
          <span>{toast.message}</span>
        </div>
      )}
    </Shell>
  );
}

/* ===================================================================== */
/* Login                                                                 */
/* ===================================================================== */
function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!username || !password) { setErr('Enter your username and password.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch(AUTH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Sign-in failed.'); return; }
      onLogin(data.user);
    } catch {
      setErr('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark lg">U</div>
        <h1 className="login-title">Underdawg</h1>
        <p className="login-sub">Sign in to continue</p>
        <label className="login-label">Username</label>
        <input className="login-input" value={username} autoFocus autoCapitalize="none"
          onChange={(e) => setUsername(e.target.value)} placeholder="username" />
        <label className="login-label">Password</label>
        <input className="login-input" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        {err && <div className="login-err">{err}</div>}
        <button className="btn btn-primary login-btn" disabled={busy}>
          {busy ? <Spinner /> : null}<span>Sign in</span>
        </button>
      </form>
    </div>
  );
}

/* ===================================================================== */
/* Dashboard shell (sidebar + content)                                   */
/* ===================================================================== */
function Shell({ user, view, setView, onLogout, children }) {
  const isAdmin = can(user, 'manage_users');
  const title = view === 'users' ? 'Users & Access' : 'Collect';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="side-brand">
          <div className="brand-mark">U</div>
          <span>Underdawg</span>
        </div>
        <nav className="side-nav">
          <button className={`nav-item ${view === 'collect' ? 'active' : ''}`} onClick={() => setView('collect')}>
            <CollectIcon /><span>Collect</span>
          </button>
          {isAdmin && (
            <button className={`nav-item ${view === 'users' ? 'active' : ''}`} onClick={() => setView('users')}>
              <UsersIcon /><span>Users & Access</span>
            </button>
          )}
        </nav>
        <div className="side-foot">
          <div className="user-card">
            <div className="user-avatar">{(user.username[0] || '?').toUpperCase()}</div>
            <div className="user-meta">
              <div className="user-name">{user.username}</div>
              <div className="user-role">{isAdmin ? 'Admin' : 'Data entry'}</div>
            </div>
          </div>
          <button className="btn btn-ghost logout-btn" onClick={onLogout}>
            <LogoutIcon /><span>Sign out</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar"><h2>{title}</h2></div>
        <div className="main-body">{children}</div>
      </main>
    </div>
  );
}

/* ===================================================================== */
/* Collect view (the username collector, permission-gated)               */
/* ===================================================================== */
function CollectView({ user, showToast }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [artist, setArtist] = useState('');
  const [influencer, setInfluencer] = useState('');
  const [busy, setBusy] = useState({ artist: false, influencer: false });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [groupByTier, setGroupByTier] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [refreshing, setRefreshing] = useState(false);

  const canAdd = can(user, 'add_entries');
  const canViewMetrics = can(user, 'view_metrics');
  const canViewList = canViewMetrics || can(user, 'view_list'); // metrics implies list
  const canExport = can(user, 'export') && canViewMetrics; // CSV contains metrics
  const canDelete = can(user, 'delete_entries');
  const canRefresh = can(user, 'refresh_metrics') && canViewMetrics;

  async function loadEntries() {
    setLoading(true); setError('');
    try {
      const res = await fetch(API);
      if (!res.ok) throw new Error('Failed to load entries');
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      setError('Could not load saved usernames. Check your connection and refresh.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadEntries(); }, []);

  function findDuplicate(name) {
    const lower = name.trim().replace(/^@+/, '').toLowerCase();
    return entries.find((e) => e.usernameLower === lower) || null;
  }
  function typeLabel(type) { return type === 'artist' ? 'an Artist' : 'an Influencer'; }

  async function addEntry(type) {
    const raw = type === 'artist' ? artist : influencer;
    const name = raw.trim().replace(/^@+/, '').trim();
    if (!name) { showToast('error', 'Please type a username first.'); return; }
    const dupe = findDuplicate(name);
    if (dupe) { showToast('error', `"${name}" is already in the list as ${typeLabel(dupe.type)}.`); return; }
    setBusy((b) => ({ ...b, [type]: true }));
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, type }),
      });
      const data = await res.json();
      if (res.status === 409) { showToast('error', data.error || `"${name}" already exists.`); return; }
      if (!res.ok) { showToast('error', data.error || 'Could not save. Try again.'); return; }
      const entry = data.entry;
      setEntries((prev) => [entry, ...prev]);
      if (type === 'artist') setArtist(''); else setInfluencer('');
      let extra = '';
      if (entry.enrichStatus === 'undiscoverable') extra = ' — couldn’t fetch (private/personal)';
      else if (entry.enrichStatus === 'pending') extra = ' — metrics pending';
      else if (entry.enrichStatus === 'error') extra = ' — enrich failed';
      else if (entry.categoryMismatch && entry.inferredType) extra = ` — ⚠ looks like ${entry.inferredType}`;
      showToast('success', `Added ${type === 'artist' ? 'Artist' : 'Influencer'} "${name}".${extra}`);
    } catch {
      showToast('error', 'Network error. Please try again.');
    } finally {
      setBusy((b) => ({ ...b, [type]: false }));
    }
  }

  async function deleteEntry(entry) {
    const prev = entries;
    setEntries((list) => list.filter((e) => e._id !== entry._id));
    try {
      const res = await fetch(`${API}?id=${encodeURIComponent(entry._id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('success', `Removed "${entry.username}".`);
    } catch {
      setEntries(prev);
      showToast('error', 'Could not delete. Try again.');
    }
  }

  async function refreshMetrics() {
    setRefreshing(true);
    try {
      const res = await fetch(`${ENRICH_API}?all=1&limit=50`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      await loadEntries();
      if (data.tokenInvalid) showToast('error', 'Instagram token invalid — update IG_TOKEN.');
      else {
        let msg = `Enriched ${data.updated}. ${data.remaining} still pending.`;
        if (data.rateLimited) msg += ' Rate limit hit — try again later.';
        showToast('success', msg);
      }
    } catch {
      showToast('error', 'Could not refresh metrics.');
    } finally {
      setRefreshing(false);
    }
  }

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const counts = useMemo(() => ({
    artists: entries.filter((e) => e.type === 'artist').length,
    influencers: entries.filter((e) => e.type === 'influencer').length,
    total: entries.length,
  }), [entries]);

  const todayByBucket = useMemo(() => {
    const todayStr = new Date().toDateString();
    const acc = Object.fromEntries(TIERS.map((t) => [t, { artist: 0, influencer: 0 }]));
    for (const e of entries) {
      if (new Date(e.createdAt).toDateString() !== todayStr) continue;
      const t = e.metrics?.followerTier;
      if (!t || !acc[t]) continue;
      if (e.type === 'artist') acc[t].artist += 1;
      else if (e.type === 'influencer') acc[t].influencer += 1;
    }
    return acc;
  }, [entries]);
  const totalToday = Object.values(todayByBucket).reduce((s, b) => s + b.artist + b.influencer, 0);

  const pendingCount = useMemo(
    () => entries.filter((e) => { const s = e.enrichStatus || 'pending'; return s === 'pending' || s === 'error'; }).length,
    [entries]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter !== 'all' && e.type !== filter) return false;
      if (tierFilter !== 'all' && e.metrics?.followerTier !== tierFilter) return false;
      if (q && !e.username.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, search, filter, tierFilter]);

  // counts per tier, respecting the current type filter + search (but NOT the
  // tier filter itself) so each tab shows how many it would reveal.
  const tierCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = entries.filter((e) => {
      if (filter !== 'all' && e.type !== filter) return false;
      if (q && !e.username.toLowerCase().includes(q)) return false;
      return true;
    });
    const c = { all: base.length, nano: 0, micro: 0, mid: 0, mega: 0 };
    for (const e of base) {
      const t = e.metrics?.followerTier;
      if (t && c[t] !== undefined) c[t] += 1;
    }
    return c;
  }, [entries, filter, search]);

  const grouped = useMemo(() => {
    const map = Object.fromEntries(TIERS.map((t) => [t, []]));
    const unknown = [];
    for (const e of visible) {
      const t = e.metrics?.followerTier;
      if (t && map[t]) map[t].push(e); else unknown.push(e);
    }
    const out = TIERS.filter((t) => map[t].length).map((t) => ({
      key: t, label: TIER_META[t].label, sub: TIER_META[t].sub, items: map[t],
    }));
    if (unknown.length) out.push({ key: 'unknown', label: 'Pending / unranked', sub: '', items: unknown });
    return out;
  }, [visible]);

  function exportCsv() {
    if (entries.length === 0) { showToast('error', 'Nothing to export yet.'); return; }
    const header = [
      'Username', 'Type', 'Tier', 'Followers', 'Following', 'Posts',
      'EngagementRateMedian', 'EngagementRateMean', 'AvgLikes', 'AvgComments',
      'CommentLikeRatio', 'PostsPerWeek', 'ViralFlag', 'InferredType',
      'CategoryMismatch', 'EnrichStatus', 'Added At',
    ];
    const rows = entries.map((e) => {
      const m = e.metrics || {};
      return [
        e.username, e.type, m.followerTier ?? '', e.raw?.followers_count ?? '',
        e.raw?.follows_count ?? '', e.raw?.media_count ?? '',
        m.engagementRateMedian ?? '', m.engagementRateMean ?? '',
        m.avgLikes ?? '', m.avgComments ?? '', m.commentToLikeRatio ?? '',
        m.postsPerWeek ?? '', m.viralReachFlag ? 'yes' : '',
        e.inferredType ?? '', e.categoryMismatch ? 'yes' : '',
        e.enrichStatus ?? '', e.createdAt,
      ];
    });
    const escape = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [header, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `underdawg-usernames-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    showToast('success', `Exported ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
  }

  const onKey = (e, type) => { if (e.key === 'Enter') addEntry(type); };
  const totalGoal = TIERS.length * 2 * DAILY_TIER_GOAL;

  return (
    <div className="view collect-view">
      {canExport && (
        <div className="view-actions">
          <button className="btn btn-ghost export-btn" onClick={exportCsv}>
            <DownloadIcon /><span>Export CSV</span>
          </button>
        </div>
      )}

      {canViewList && (
        <section className="stats">
          <StatCard label="Total" value={counts.total} accent="violet" />
          <StatCard label="Artists" value={counts.artists} accent="pink" />
          <StatCard label="Influencers" value={counts.influencers} accent="blue" />
        </section>
      )}

      <TierProgressGrid byBucket={todayByBucket} total={totalToday} totalGoal={totalGoal} />

      {canAdd && (
        <section className="card inputs">
          <Field label="Artist username" placeholder="e.g. taylorswift" value={artist}
            onChange={setArtist} onKeyDown={(e) => onKey(e, 'artist')}
            onAdd={() => addEntry('artist')} busy={busy.artist} tone="pink" />
          <Field label="Influencer username" placeholder="e.g. mrbeast" value={influencer}
            onChange={setInfluencer} onKeyDown={(e) => onKey(e, 'influencer')}
            onAdd={() => addEntry('influencer')} busy={busy.influencer} tone="blue" />
        </section>
      )}

      {canViewList && (
        <section className="card list-card">
          <div className="list-toolbar">
            <div className="search">
              <SearchIcon />
              <input type="text" placeholder="Search usernames…" value={search}
                onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="segmented">
              {['all', 'artist', 'influencer'].map((f) => (
                <button key={f} className={`seg ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f === 'artist' ? 'Artists' : 'Influencers'}
                </button>
              ))}
            </div>
          </div>

          {canViewMetrics && (
            <div className="filters-row">
              <div className="segmented tier-seg">
                {['all', ...TIERS].map((t) => (
                  <button key={t} className={`seg ${tierFilter === t ? 'active' : ''}`} onClick={() => setTierFilter(t)}>
                    {t === 'all' ? 'All tiers' : TIER_META[t].label}
                    <span className="seg-count">{tierCounts[t]}</span>
                  </button>
                ))}
              </div>
              <select className="tier-select" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
                <option value="all">All tiers ({tierCounts.all})</option>
                {TIERS.map((t) => <option key={t} value={t}>{TIER_META[t].label} ({TIER_META[t].sub}) — {tierCounts[t]}</option>)}
              </select>
              <label className="group-toggle">
                <input type="checkbox" checked={groupByTier} onChange={(e) => setGroupByTier(e.target.checked)} />
                Group by tier
              </label>
            </div>
          )}

          {pendingCount > 0 && canRefresh && (
            <div className="pending-banner">
              <span>{pendingCount} entr{pendingCount === 1 ? 'y' : 'ies'} awaiting metrics</span>
              <button className="btn btn-ghost" onClick={refreshMetrics} disabled={refreshing}>
                <RefreshIcon spinning={refreshing} />
                <span>{refreshing ? 'Refreshing…' : 'Refresh metrics'}</span>
              </button>
            </div>
          )}

          {loading ? (
            <div className="state">Loading saved usernames…</div>
          ) : error ? (
            <div className="state error">{error}<button className="btn btn-ghost" onClick={loadEntries}>Retry</button></div>
          ) : visible.length === 0 ? (
            <div className="state empty">
              {entries.length === 0 ? 'No usernames yet — add your first one above.' : 'No matches for your search/filter.'}
            </div>
          ) : groupByTier ? (
            grouped.map((g) => (
              <div key={g.key}>
                <div className="tier-group-head">
                  {g.label}{g.sub ? ` · ${g.sub}` : ''}<span className="dash" /><span className="gcount">{g.items.length}</span>
                </div>
                <ul className="entries">
                  {g.items.map((e) => (
                    <EntryRow key={e._id} e={e} expanded={expanded.has(e._id)}
                      onToggle={toggleExpand} onDelete={deleteEntry}
                      canDelete={canDelete} showMetrics={canViewMetrics} />
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <ul className="entries">
              {visible.map((e) => (
                <EntryRow key={e._id} e={e} expanded={expanded.has(e._id)}
                  onToggle={toggleExpand} onDelete={deleteEntry}
                  canDelete={canDelete} showMetrics={canViewMetrics} />
              ))}
            </ul>
          )}
          <div className="list-foot">Showing {visible.length} of {counts.total}</div>
        </section>
      )}

      {!canViewList && canAdd && (
        <p className="entry-note">You have add-only access. Newly added usernames are enriched automatically in the background.</p>
      )}
    </div>
  );
}

/* ===================================================================== */
/* Users & Access (admin)                                                */
/* ===================================================================== */
function UsersView({ me, showToast }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nu, setNu] = useState({ username: '', password: '', permissions: { add_entries: true } });
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(USERS_API);
      const data = await res.json();
      if (res.ok) setUsers(data.users || []);
      else showToast('error', data.error || 'Could not load users.');
    } catch { showToast('error', 'Could not load users.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function createUser(e) {
    e.preventDefault();
    if (!nu.username || !nu.password) { showToast('error', 'Username and password required.'); return; }
    setCreating(true);
    try {
      const res = await fetch(USERS_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nu),
      });
      const data = await res.json();
      if (!res.ok) { showToast('error', data.error || 'Could not create user.'); return; }
      setUsers((u) => [...u, data.user]);
      setNu({ username: '', password: '', permissions: { add_entries: true } });
      showToast('success', `Created "${data.user.username}".`);
    } catch { showToast('error', 'Could not create user.'); }
    finally { setCreating(false); }
  }

  async function savePermissions(u, permissions) {
    try {
      const res = await fetch(`${USERS_API}?id=${u._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissions }),
      });
      const data = await res.json();
      if (!res.ok) { showToast('error', data.error || 'Update failed.'); return; }
      setUsers((list) => list.map((x) => (x._id === u._id ? data.user : x)));
      showToast('success', `Updated "${u.username}".`);
    } catch { showToast('error', 'Update failed.'); }
  }

  async function resetPassword(u) {
    const pw = window.prompt(`New password for "${u.username}" (min 6 chars):`);
    if (!pw) return;
    try {
      const res = await fetch(`${USERS_API}?id=${u._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (!res.ok) { showToast('error', data.error || 'Update failed.'); return; }
      showToast('success', `Password updated for "${u.username}".`);
    } catch { showToast('error', 'Update failed.'); }
  }

  async function deleteUser(u) {
    if (!window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${USERS_API}?id=${u._id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { showToast('error', data.error || 'Delete failed.'); return; }
      setUsers((list) => list.filter((x) => x._id !== u._id));
      showToast('success', `Deleted "${u.username}".`);
    } catch { showToast('error', 'Delete failed.'); }
  }

  return (
    <div className="view users-view">
      <section className="card">
        <h3 className="card-title">Add a user</h3>
        <form className="user-create" onSubmit={createUser}>
          <input className="login-input" placeholder="username" autoCapitalize="none"
            value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
          <input className="login-input" type="password" placeholder="password (min 6)"
            value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          <div className="preset-row">
            <span className="preset-label">Preset</span>
            <button type="button" className="preset-btn"
              onClick={() => setNu({ ...nu, permissions: { add_entries: true } })}>
              Add only
            </button>
            <button type="button" className="preset-btn"
              onClick={() => setNu({ ...nu, permissions: { add_entries: true, view_list: true } })}>
              Add + list (no metrics)
            </button>
            <button type="button" className="preset-btn"
              onClick={() => setNu({ ...nu, permissions: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true])) })}>
              Full admin
            </button>
          </div>
          <div className="perm-chips">
            {PERMISSION_KEYS.map((k) => (
              <label key={k} className={`perm-chip ${nu.permissions[k] ? 'on' : ''}`}>
                <input type="checkbox" checked={!!nu.permissions[k]}
                  onChange={(e) => setNu({ ...nu, permissions: { ...nu.permissions, [k]: e.target.checked } })} />
                {PERMISSION_LABELS[k]}
              </label>
            ))}
          </div>
          <button className="btn btn-primary" disabled={creating}>
            {creating ? <Spinner /> : <PlusIcon />}<span>Create user</span>
          </button>
        </form>
      </section>

      <section className="card">
        <h3 className="card-title">Users &amp; permissions</h3>
        {loading ? (
          <div className="state">Loading users…</div>
        ) : (
          <div className="users-table">
            <div className="ut-head">
              <span>User</span>
              {PERMISSION_KEYS.map((k) => <span key={k} className="ut-perm" title={PERMISSION_LABELS[k]}>{PERMISSION_LABELS[k]}</span>)}
              <span>Actions</span>
            </div>
            {users.map((u) => (
              <UserRow key={u._id} u={u} isMe={u._id === me._id}
                onToggle={(perms) => savePermissions(u, perms)}
                onResetPw={() => resetPassword(u)} onDelete={() => deleteUser(u)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function UserRow({ u, isMe, onToggle, onResetPw, onDelete }) {
  function toggle(k) {
    const next = { ...u.permissions, [k]: !u.permissions[k] };
    onToggle(next);
  }
  return (
    <div className="ut-row">
      <span className="ut-user">
        <span className="user-avatar sm">{(u.username[0] || '?').toUpperCase()}</span>
        <span>{u.username}{isMe && <em className="ut-you"> (you)</em>}</span>
      </span>
      {PERMISSION_KEYS.map((k) => (
        <span key={k} className="ut-perm">
          <button className={`perm-dot ${u.permissions[k] ? 'on' : ''}`} title={PERMISSION_LABELS[k]}
            aria-label={`${PERMISSION_LABELS[k]}: ${u.permissions[k] ? 'on' : 'off'}`}
            onClick={() => toggle(k)}>
            {u.permissions[k] ? <CheckIcon /> : null}
          </button>
        </span>
      ))}
      <span className="ut-actions">
        <button className="icon-btn" title="Reset password" onClick={onResetPw}><KeyIcon /></button>
        {!isMe && <button className="icon-btn" title="Delete user" onClick={onDelete}><TrashIcon /></button>}
      </span>
    </div>
  );
}

/* ===================================================================== */
/* Formatting helpers                                                    */
/* ===================================================================== */
function trimNum(x) { return (Math.round(x * 10) / 10).toString().replace(/\.0$/, ''); }
function formatCount(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const num = Number(n); const a = Math.abs(num);
  if (a >= 1e6) return trimNum(num / 1e6) + 'M';
  if (a >= 1e3) return trimNum(num / 1e3) + 'k';
  return String(num);
}
function formatPct(x) { if (x == null || Number.isNaN(Number(x))) return '—'; return (Math.round(Number(x) * 10) / 10) + '%'; }
function formatRatio(x) { if (x == null || Number.isNaN(Number(x))) return '—'; return String(Math.round(Number(x) * 100) / 100); }
function instagramUrl(u) { return 'https://instagram.com/' + encodeURIComponent(String(u).replace(/^@+/, '')); }
function prettyUrl(u) { return String(u).replace(/^https?:\/\//, '').replace(/\/$/, ''); }

/* ===================================================================== */
/* Daily targets                                                         */
/* ===================================================================== */
function TierProgressGrid({ byBucket, total, totalGoal }) {
  return (
    <section className="card targets">
      <div className="targets-head">
        <div className="targets-title">Today’s targets <span>· {DAILY_TIER_GOAL} each</span></div>
        <div className="targets-total">{total}<span> / {totalGoal}</span></div>
      </div>
      <div className="tier-grid">
        {TIERS.map((t) => <TierProgressCell key={t} tier={t} counts={byBucket[t]} />)}
      </div>
    </section>
  );
}
function TierProgressCell({ tier, counts }) {
  return (
    <div className={`tier-cell ${tier}`}>
      <div className="tier-cell-head">
        <span className="tier-cell-name">{TIER_META[tier].label}</span>
        <span className="tier-cell-sub">{TIER_META[tier].sub}</span>
      </div>
      <BucketRow type="artist" count={counts.artist} />
      <BucketRow type="influencer" count={counts.influencer} />
    </div>
  );
}
function BucketRow({ type, count }) {
  const pct = Math.min(100, Math.round((count / DAILY_TIER_GOAL) * 100));
  const done = count >= DAILY_TIER_GOAL;
  const barClass = done ? 'bar-done' : type === 'artist' ? 'bar-artist' : 'bar-influencer';
  return (
    <div className="bucket-row">
      <span className={`type-glyph ${type}`} title={type === 'artist' ? 'Artists' : 'Influencers'}>{type === 'artist' ? 'A' : 'I'}</span>
      <div className="mini-track"><div className={`mini-bar ${barClass}`} style={{ width: `${pct}%` }} /></div>
      <span className="bucket-count">{count}<span>/{DAILY_TIER_GOAL}</span></span>
    </div>
  );
}

/* ===================================================================== */
/* Entry row                                                             */
/* ===================================================================== */
function EntryRow({ e, expanded, onToggle, onDelete, canDelete, showMetrics }) {
  const status = e.enrichStatus || 'pending';
  const m = e.metrics || {};
  const raw = e.raw || {};
  const tier = m.followerTier || null;
  const er = m.engagementRateMedian ?? m.engagementRateMean ?? null;
  const isPending = status === 'pending';
  const canOpen = !isPending;

  function openIg() { if (canOpen) window.open(instagramUrl(e.username), '_blank', 'noopener,noreferrer'); }

  return (
    <li className="entry-card">
      <div className={`entry-main${isPending ? ' is-pending' : ''}`} role="button" tabIndex={0}
        onClick={openIg}
        onKeyDown={(ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && canOpen) { ev.preventDefault(); openIg(); } }}
        aria-label={`Open @${e.username} on Instagram`} aria-busy={isPending}>
        <Avatar e={e} showPhoto={showMetrics} />
        <div className="entry-body">
          <div className="name-line">
            <span className="entry-handle">@{e.username}</span>
            <span className={`badge ${e.type}`}>{e.type === 'artist' ? 'Artist' : 'Influencer'}</span>
            {showMetrics && tier && <span className={`tier-badge ${tier}`}>{tier}</span>}
            {showMetrics && raw.name && <span className="entry-realname">{raw.name}</span>}
          </div>
          {showMetrics && (
            <div className="meta-line">
              {status === 'ok' && (
                <>
                  <span className="chip"><UsersIcon /><b>{formatCount(raw.followers_count)}</b></span>
                  <span className="chip"><HeartIcon /><b>{formatPct(er)}</b>&nbsp;ER</span>
                </>
              )}
              {m.viralReachFlag && <span className="flag viral" title="Some posts get more likes than followers — viral reach"><FlameIcon />viral</span>}
              {e.categoryMismatch && e.inferredType && (
                <span className="flag mismatch" title={e.inferReason || 'Possibly miscategorized'}><WarningIcon />maybe {e.inferredType}</span>
              )}
              {isPending && <span className="flag pending"><span className="spinner" />enriching…</span>}
              {status === 'undiscoverable' && <span className="flag undisc"><LockIcon />undiscoverable</span>}
              {status === 'error' && <span className="flag error"><WarningIcon />enrich failed</span>}
            </div>
          )}
        </div>
        <div className="entry-actions">
          {showMetrics && (
            <button className={`icon-btn expand${expanded ? ' is-open' : ''}`} aria-expanded={expanded}
              aria-label="Toggle details" onClick={(ev) => { ev.stopPropagation(); onToggle(e._id); }}>
              <ChevronIcon />
            </button>
          )}
          {canDelete && (
            <button className="icon-btn" title="Remove" aria-label={`Remove ${e.username}`}
              onClick={(ev) => { ev.stopPropagation(); onDelete(e); }}>
              <TrashIcon />
            </button>
          )}
        </div>
      </div>
      {showMetrics && expanded && <EntryDetail e={e} />}
    </li>
  );
}

function Avatar({ e, showPhoto = true }) {
  const url = showPhoto ? e.raw?.profile_picture_url : null;
  const [err, setErr] = useState(false);
  const ring = e.type === 'artist' ? 'ring-artist' : 'ring-influencer';
  if (url && !err) {
    return (
      <div className={`avatar ${ring}`}>
        <img src={url} alt={`@${e.username}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setErr(true)} />
      </div>
    );
  }
  return <div className={`avatar ${ring}`}>{(e.username[0] || '?').toUpperCase()}</div>;
}

function EntryDetail({ e }) {
  const status = e.enrichStatus || 'pending';
  if (status === 'pending') {
    return <div className="entry-detail"><div className="detail-undisc">Metrics are being fetched — use “Refresh metrics” if this persists.</div></div>;
  }
  if (status === 'undiscoverable') {
    return (
      <div className="entry-detail">
        <div className="detail-undisc">🔒 This account is private, personal, or not found — Instagram returns no business data for it.</div>
        <div className="detail-links">
          <a className="detail-link" href={instagramUrl(e.username)} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon />Open on Instagram</a>
        </div>
      </div>
    );
  }
  if (status === 'error') {
    return <div className="entry-detail"><div className="detail-undisc">Couldn’t fetch metrics ({e.enrichError || 'error'}). Try “Refresh metrics”.</div></div>;
  }
  const m = e.metrics || {};
  const raw = e.raw || {};
  const mix = m.contentMix;
  return (
    <div className="entry-detail">
      {raw.biography && <p className="detail-bio">{raw.biography}</p>}
      <div className="detail-links">
        {raw.website && <a className="detail-link" href={raw.website} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon />{prettyUrl(raw.website)}</a>}
        <a className="detail-link" href={instagramUrl(e.username)} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon />Open on Instagram</a>
      </div>
      <div className="detail-grid">
        <MetricStat label="Followers" value={formatCount(raw.followers_count)} />
        <MetricStat label="Following" value={formatCount(raw.follows_count)} />
        <MetricStat label="Posts" value={formatCount(raw.media_count)} />
        <MetricStat label="F/F ratio" value={formatRatio(m.followerFollowingRatio)} />
        <MetricStat label="ER (median)" value={formatPct(m.engagementRateMedian)} />
        <MetricStat label="ER (mean)" value={formatPct(m.engagementRateMean)} />
        <MetricStat label="Avg likes" value={formatCount(m.avgLikes)} />
        <MetricStat label="Avg comments" value={formatCount(m.avgComments)} />
        <MetricStat label="Comment/like" value={formatRatio(m.commentToLikeRatio)} />
        <MetricStat label="Posts/week" value={m.postsPerWeek == null ? '—' : m.postsPerWeek} />
        <MetricStat label="Last post" value={m.daysSinceLastPost == null ? '—' : `${m.daysSinceLastPost}d ago`} />
        <MetricStat label="Cadence" value={m.postingCadence || '—'} />
      </div>
      {mix && <ContentMixBar mix={mix} />}
    </div>
  );
}

function MetricStat({ label, value }) {
  return <div className="metric-stat"><div className="ms-label">{label}</div><div className="ms-value">{value}</div></div>;
}

function ContentMixBar({ mix }) {
  const segs = [
    ['reel', 'Reel', mix.reel], ['carousel', 'Carousel', mix.carousel],
    ['image', 'Image', mix.feedImage], ['video', 'Video', mix.feedVideo],
  ];
  const shown = segs.filter(([, , pct]) => pct > 0);
  if (!shown.length) return null;
  return (
    <div className="mix-wrap">
      <div className="mix-title">CONTENT MIX</div>
      <div className="mix-bar">{shown.map(([cls, , pct]) => <div key={cls} className={`mix-seg ${cls}`} style={{ width: `${pct}%` }} />)}</div>
      <div className="mix-legend">{shown.map(([cls, label, pct]) => <span key={cls}><i className={`legend-dot ${cls}`} />{label} {Math.round(pct)}%</span>)}</div>
    </div>
  );
}

/* ===================================================================== */
/* Small components                                                      */
/* ===================================================================== */
function Field({ label, placeholder, value, onChange, onKeyDown, onAdd, busy, tone }) {
  return (
    <div className={`field tone-${tone}`}>
      <label>{label}</label>
      <div className="field-row">
        <span className="at">@</span>
        <input type="text" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown} autoCapitalize="none" autoCorrect="off" spellCheck="false" />
        <button className="btn btn-primary" onClick={onAdd} disabled={busy}>
          {busy ? <Spinner /> : <PlusIcon />}<span>Add</span>
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return <div className={`stat stat-${accent}`}><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>;
}

/* ---------- Icons ---------- */
function PlusIcon() { return (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>); }
function DownloadIcon() { return (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>); }
function SearchIcon() { return (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>); }
function TrashIcon() { return (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" /></svg>); }
function CheckIcon() { return (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>); }
function AlertIcon() { return (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 8v5M12 16h.01" /><circle cx="12" cy="12" r="9" /></svg>); }
function ChevronIcon() { return (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>); }
function FlameIcon() { return (<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2c1 3-1 4-2 6-1 2 0 4 2 4s3-1 3-3c2 1 3 3 3 5a6 6 0 0 1-12 0c0-3 2-5 3-7 1-2 2-3 0-5 .7.2 1.4.5 2 .9z" /></svg>); }
function LockIcon() { return (<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>); }
function WarningIcon() { return (<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></svg>); }
function ExternalLinkIcon() { return (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 5h5v5M19 5l-8 8M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>); }
function UsersIcon() { return (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="M16 5.2A3 3 0 0 1 16 11M20.5 20c0-2.4-1.4-4.2-3.5-4.8" /></svg>); }
function HeartIcon() { return (<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 21s-7-4.5-9.5-9C1 9 2.5 5.5 6 5.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.5 0 5 3.5 3.5 6.5C19 16.5 12 21 12 21z" /></svg>); }
function CollectIcon() { return (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="4" rx="1" /><rect x="3" y="11" width="18" height="4" rx="1" /><rect x="3" y="18" width="18" height="3" rx="1" /></svg>); }
function LogoutIcon() { return (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 17l-5-5 5-5M5 12h12" /></svg>); }
function KeyIcon() { return (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="4" /><path d="M11 11l9 9M17 17l2-2M14 14l2-2" /></svg>); }
function RefreshIcon({ spinning }) { return (<svg className={spinning ? 'spin-svg' : ''} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v5h-5" /></svg>); }
function Spinner() { return <span className="spinner" aria-hidden="true" />; }
