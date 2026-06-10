import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const API = '/api/entries';

export default function App() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [artist, setArtist] = useState('');
  const [influencer, setInfluencer] = useState('');
  const [busy, setBusy] = useState({ artist: false, influencer: false });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | artist | influencer
  const [toast, setToast] = useState(null); // { type, message }

  const toastTimer = useRef(null);

  // ---- Toast helper -------------------------------------------------------
  function showToast(type, message) {
    setToast({ type, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  // ---- Load entries -------------------------------------------------------
  async function loadEntries() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(API);
      if (!res.ok) throw new Error('Failed to load entries');
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (e) {
      setError('Could not load saved usernames. Check your connection and refresh.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEntries();
    return () => toastTimer.current && clearTimeout(toastTimer.current);
  }, []);

  // ---- Client-side duplicate guard (instant feedback) ---------------------
  // Returns the existing entry if found, otherwise null.
  function findDuplicate(name) {
    const lower = name.trim().replace(/^@+/, '').toLowerCase();
    return entries.find((e) => e.usernameLower === lower) || null;
  }

  function typeLabel(type) {
    return type === 'artist' ? 'an Artist' : 'an Influencer';
  }

  // ---- Add an entry -------------------------------------------------------
  async function addEntry(type) {
    const raw = type === 'artist' ? artist : influencer;
    const name = raw.trim().replace(/^@+/, '').trim();

    if (!name) {
      showToast('error', 'Please type a username first.');
      return;
    }
    const dupe = findDuplicate(name);
    if (dupe) {
      showToast('error', `"${name}" is already in the list as ${typeLabel(dupe.type)}.`);
      return;
    }

    setBusy((b) => ({ ...b, [type]: true }));
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, type }),
      });
      const data = await res.json();

      if (res.status === 409) {
        showToast('error', data.error || `"${name}" already exists.`);
        return;
      }
      if (!res.ok) {
        showToast('error', data.error || 'Could not save. Try again.');
        return;
      }

      setEntries((prev) => [data.entry, ...prev]);
      if (type === 'artist') setArtist('');
      else setInfluencer('');
      showToast('success', `Added ${type === 'artist' ? 'Artist' : 'Influencer'} "${name}".`);
    } catch (e) {
      showToast('error', 'Network error. Please try again.');
    } finally {
      setBusy((b) => ({ ...b, [type]: false }));
    }
  }

  // ---- Delete an entry ----------------------------------------------------
  async function deleteEntry(entry) {
    const prev = entries;
    setEntries((list) => list.filter((e) => e._id !== entry._id)); // optimistic
    try {
      const res = await fetch(`${API}?id=${encodeURIComponent(entry._id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('success', `Removed "${entry.username}".`);
    } catch {
      setEntries(prev); // revert
      showToast('error', 'Could not delete. Try again.');
    }
  }

  // ---- Derived data -------------------------------------------------------
  const counts = useMemo(() => {
    const artists = entries.filter((e) => e.type === 'artist').length;
    const influencers = entries.filter((e) => e.type === 'influencer').length;
    return { artists, influencers, total: entries.length };
  }, [entries]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter !== 'all' && e.type !== filter) return false;
      if (q && !e.username.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, search, filter]);

  // ---- CSV export ---------------------------------------------------------
  function exportCsv() {
    if (entries.length === 0) {
      showToast('error', 'Nothing to export yet.');
      return;
    }
    const header = ['Username', 'Type', 'Added At'];
    const rows = entries.map((e) => [e.username, e.type, e.createdAt]);
    const escape = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `underdawg-usernames-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('success', `Exported ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
  }

  function onKey(e, type) {
    if (e.key === 'Enter') addEntry(type);
  }

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <header className="header">
          <div className="brand">
            <div className="brand-mark">U</div>
            <div>
              <h1>Underdawg</h1>
              <p>Artist &amp; Influencer username collector</p>
            </div>
          </div>
          <button className="btn btn-ghost export-btn" onClick={exportCsv}>
            <DownloadIcon />
            <span>Export CSV</span>
          </button>
        </header>

        {/* Stats */}
        <section className="stats">
          <StatCard label="Total" value={counts.total} accent="violet" />
          <StatCard label="Artists" value={counts.artists} accent="pink" />
          <StatCard label="Influencers" value={counts.influencers} accent="blue" />
        </section>

        {/* Input card */}
        <section className="card inputs">
          <Field
            label="Artist username"
            placeholder="e.g. taylorswift"
            value={artist}
            onChange={setArtist}
            onKeyDown={(e) => onKey(e, 'artist')}
            onAdd={() => addEntry('artist')}
            busy={busy.artist}
            tone="pink"
          />
          <Field
            label="Influencer username"
            placeholder="e.g. mrbeast"
            value={influencer}
            onChange={setInfluencer}
            onKeyDown={(e) => onKey(e, 'influencer')}
            onAdd={() => addEntry('influencer')}
            busy={busy.influencer}
            tone="blue"
          />
        </section>

        {/* List card */}
        <section className="card list-card">
          <div className="list-toolbar">
            <div className="search">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search usernames…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="segmented">
              {['all', 'artist', 'influencer'].map((f) => (
                <button
                  key={f}
                  className={`seg ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'artist' ? 'Artists' : 'Influencers'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="state">Loading saved usernames…</div>
          ) : error ? (
            <div className="state error">
              {error}
              <button className="btn btn-ghost" onClick={loadEntries}>
                Retry
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="state empty">
              {entries.length === 0
                ? 'No usernames yet — add your first one above.'
                : 'No matches for your search/filter.'}
            </div>
          ) : (
            <ul className="entries">
              {visible.map((e) => (
                <li key={e._id} className="entry">
                  <span className={`badge ${e.type}`}>
                    {e.type === 'artist' ? 'Artist' : 'Influencer'}
                  </span>
                  <span className="entry-name">@{e.username}</span>
                  <span className="entry-date">{formatDate(e.createdAt)}</span>
                  <button
                    className="icon-btn"
                    title="Remove"
                    aria-label={`Remove ${e.username}`}
                    onClick={() => deleteEntry(e)}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="footer">
          Showing {visible.length} of {counts.total} · Data stored securely in MongoDB
        </footer>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          {toast.type === 'success' ? <CheckIcon /> : <AlertIcon />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- Small components ---------- */

function Field({ label, placeholder, value, onChange, onKeyDown, onAdd, busy, tone }) {
  return (
    <div className={`field tone-${tone}`}>
      <label>{label}</label>
      <div className="field-row">
        <span className="at">@</span>
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
        />
        <button className="btn btn-primary" onClick={onAdd} disabled={busy}>
          {busy ? <Spinner /> : <PlusIcon />}
          <span>Add</span>
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className={`stat stat-${accent}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/* ---------- Icons (inline SVG) ---------- */

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 8v5M12 16h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
