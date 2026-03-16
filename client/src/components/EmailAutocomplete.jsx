import React, { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../api';

let contactsCache = null;
let contactsLoading = false;
let contactsCallbacks = [];

function loadContacts() {
  if (contactsCache) return Promise.resolve(contactsCache);
  if (contactsLoading) return new Promise(r => contactsCallbacks.push(r));
  contactsLoading = true;
  return api.getGmailContacts().then(d => {
    contactsCache = d.contacts || [];
    contactsLoading = false;
    contactsCallbacks.forEach(cb => cb(contactsCache));
    contactsCallbacks = [];
    return contactsCache;
  }).catch(() => {
    contactsLoading = false;
    contactsCache = [];
    contactsCallbacks.forEach(cb => cb([]));
    contactsCallbacks = [];
    return [];
  });
}

export default function EmailAutocomplete({ value, onChange, placeholder, style, disabled }) {
  const [contacts, setContacts] = useState(contactsCache || []);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    loadContacts().then(setContacts);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const query = (value || '').trim().toLowerCase();

  const matches = useMemo(() => {
    if (!query || query.length < 1) return [];
    return contacts.filter(c =>
      c.email.includes(query) ||
      (c.name && c.name.toLowerCase().includes(query)) ||
      (c.org && c.org.toLowerCase().includes(query))
    ).slice(0, 8);
  }, [contacts, query]);

  const showDropdown = open && matches.length > 0;

  const selectContact = (c) => {
    onChange(c.email);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!showDropdown) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && matches[highlighted]) {
      e.preventDefault();
      selectContact(matches[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="email"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlighted(0); }}
        onFocus={() => { if (query) setOpen(true); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'recipient@example.com'}
        disabled={disabled}
        style={style}
        autoComplete="off"
      />
      {showDropdown && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#fff', border: '1px solid #c0d0e4', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', maxHeight: 240, overflowY: 'auto',
          marginTop: 2,
        }}>
          {matches.map((c, i) => (
            <div
              key={c.email + i}
              onClick={() => selectContact(c)}
              onMouseEnter={() => setHighlighted(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                cursor: 'pointer', fontSize: 12,
                background: i === highlighted ? '#e8f0f8' : '#fff',
              }}
            >
              {c.photo ? (
                <img src={c.photo} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} referrerPolicy="no-referrer" />
              ) : (
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1a5e9a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                  {(c.name || c.email)[0].toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {c.name && (
                  <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                )}
                <div style={{ color: '#6b8299', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email}</div>
              </div>
              {c.org && (
                <span style={{ fontSize: 10, color: '#8a9fb0', whiteSpace: 'nowrap', flexShrink: 0 }}>{c.org}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
