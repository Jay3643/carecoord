import React, { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../api';

const FOLDERS = [
  { key:'INBOX', label:'Inbox', q:'in:inbox' },
  { key:'STARRED', label:'Starred', q:'is:starred' },
  { key:'SNOOZED', label:'Snoozed', q:'is:snoozed' },
  { key:'IMPORTANT', label:'Important', q:'is:important' },
  { key:'SENT', label:'Sent', q:'in:sent' },
  { key:'DRAFT', label:'Drafts', q:'in:drafts' },
  { key:'ALL', label:'All Mail', q:'' },
  { key:'SPAM', label:'Spam', q:'in:spam' },
  { key:'TRASH', label:'Trash', q:'in:trash' },
];
const CATEGORIES = [
  { key:'CATEGORY_SOCIAL', label:'Social', q:'category:social' },
  { key:'CATEGORY_UPDATES', label:'Updates', q:'category:updates' },
  { key:'CATEGORY_FORUMS', label:'Forums', q:'category:forums' },
  { key:'CATEGORY_PROMOTIONS', label:'Promotions', q:'category:promotions' },
];

const ICONS = {
  INBOX: <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm0 16H5v-6h3.56c.69 1.19 1.97 2 3.44 2s2.75-.81 3.44-2H19v6zm0-8h-4.18C14.4 12.16 13.27 13 12 13s-2.4-.84-2.82-2H5V5h14v6z"/>,
  STARRED: <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>,
  SNOOZED: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>,
  IMPORTANT: <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>,
  SENT: <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>,
  DRAFT: <path d="M21.99 8c0-.72-.37-1.35-.94-1.7L12 1 2.95 6.3C2.38 6.65 2 7.28 2 8v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2l-.01-10zm-10 1L4 5.17l7.99-3.35L20 5.17 11.99 9z"/>,
  ALL: <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>,
  SPAM: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>,
  TRASH: <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>,
  CATEGORY_SOCIAL: <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>,
  CATEGORY_UPDATES: <path d="M18 17H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V7h12v2zM3 22l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20z"/>,
  CATEGORY_FORUMS: <path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/>,
  CATEGORY_PROMOTIONS: <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/>,
  search: <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>,
  refresh: <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>,
  chevLeft: <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>,
  chevRight: <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>,
  back: <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>,
  attach: <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 006 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>,
  reply: <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>,
};

function GIcon({ name, size = 20, color = '#5f6368' }) {
  const p = ICONS[name];
  if (!p) return null;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>{p}</svg>;
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d), now = new Date();
  if (dt.toDateString() === now.toDateString()) return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dt.getFullYear() === now.getFullYear()) return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return dt.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function senderName(f) { if (!f) return ''; const m = f.match(/^"?([^"<]+)/); return m ? m[1].trim() : f.split('@')[0]; }
function senderEmail(f) { if (!f) return ''; const m = f.match(/<([^>]+)>/); return m ? m[1] : f; }

export default function PersonalInbox({ showToast, refreshCounts }) {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [folder, setFolder] = useState('INBOX');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [nextPage, setNextPage] = useState(null);
  const [total, setTotal] = useState(0);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const ran = useRef(false);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    api.gmailStatus().then(s => { setConnected(s.connected); if (s.connected) load('INBOX'); else setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const load = (f, q, pt) => {
    if (pt) setLoadingMore(true); else setLoading(true);
    const url = '/api/gmail/personal?folder=' + encodeURIComponent(f || folder) + '&q=' + encodeURIComponent(q || '') + '&max=50' + (pt ? '&pageToken=' + pt : '');
    fetch(url, { credentials: 'include' }).then(r => r.json()).then(d => {
      if (pt) setMessages(prev => [...prev, ...(d.messages || [])]);
      else setMessages(d.messages || []);
      setNextPage(d.nextPageToken || null);
      setTotal(d.resultSizeEstimate || 0);
    }).catch(e => showToast?.(String(e))).finally(() => { setLoading(false); setLoadingMore(false); });
  };

  const pickFolder = (f) => { setFolder(f.key); setSelected(null); setDetail(null); setCheckedIds(new Set()); setSearch(''); setSearchActive(false); load(f.key); };
  const doSearch = (q) => { if (!q.trim()) { load(folder); return; } setSelected(null); setDetail(null); load('ALL', q); };

  const openMsg = async (m) => {
    setSelected(m); setShowReply(false); setDetailLoading(true);
    try {
      const d = await api.gmailPersonalMsg(m.id);
      setDetail(d);
      setMessages(prev => prev.map(x => x.id === m.id ? { ...x, isUnread: false } : x));
    } catch (e) { showToast?.(e.message); }
    finally { setDetailLoading(false); }
  };

  const sendReply = async () => {
    if (!replyBody.trim() || !detail) return;
    setSending(true);
    try {
      await api.gmailPersonalSend({ to: detail.from, subject: 'Re: ' + (detail.subject || ''), body: replyBody, threadId: detail.threadId });
      showToast?.('Sent'); setShowReply(false); setReplyBody('');
    } catch (e) { showToast?.(e.message); }
    setSending(false);
  };

  const bulkPushToQueue = async () => {
    if (checkedIds.size === 0) return;
    try {
      const d = await api.bulkPushToQueue(Array.from(checkedIds));
      showToast?.(d.pushed + ' pushed to queue');
      setMessages(prev => prev.filter(m => !checkedIds.has(m.id)));
      setCheckedIds(new Set());
      if (refreshCounts) refreshCounts();
    } catch(e) { showToast?.(e.message || 'Failed'); }
  };

  const bulkPullFromQueue = async (ticketIds) => {
    let pulled = 0;
    for (const tid of ticketIds) {
      try { await api.pullFromQueue(tid); pulled++; } catch(e) {}
    }
    showToast?.(pulled + ' pulled from queue');
  };

  

  // Scroll to load more
  const onScroll = () => {
    if (!listRef.current || !nextPage || loadingMore) return;
    const el = listRef.current;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) load(folder, search, nextPage);
  };

  if (!connected) return (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100%',background:'#fff',fontFamily:"'Google Sans',Roboto,sans-serif" }}>
      <div style={{ textAlign:'center' }}>
        <svg width="64" height="64" viewBox="0 0 24 24" fill="#dadce0"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
        <p style={{ color:'#5f6368',fontSize:14,margin:'16px 0 0' }}>Connect Google Workspace to view email</p>
      </div>
    </div>
  );

  const css = `
    .gi-row:hover { background: #f2f2f2 !important; }
    .gi-row { transition: none; }
    .gi-sb:hover { background: #e8eaed; border-radius: 0 16px 16px 0; }
    .gi-sb-active { background: #d3e3fd !important; border-radius: 0 16px 16px 0 !important; font-weight: 700 !important; color: #001d35 !important; }
    @keyframes shimmer { 0%{background-position:-600px 0} 100%{background-position:600px 0} }
    .gi-skel { background: linear-gradient(90deg,#f6f6f6 25%,#efefef 50%,#f6f6f6 75%); background-size:600px; animation: shimmer 1.5s infinite; border-radius:2px; }
    * { box-sizing: border-box; }
  `;

  return (
    <div style={{ display:'flex',height:'100%',background:'#fff',fontFamily:"'Google Sans',Roboto,-apple-system,sans-serif",fontSize:14,color:'#202124' }}>
      <style>{css}</style>

      {/* Sidebar */}
      <div style={{ width:256,flexShrink:0,background:'#f6f8fc',paddingTop:8,overflowY:'auto',overflowX:'hidden' }}>
        {FOLDERS.map(f => (
          <div key={f.key} onClick={() => pickFolder(f)} className={`gi-sb ${folder===f.key&&!searchActive?'gi-sb-active':''}`}
            style={{ display:'flex',alignItems:'center',gap:12,padding:'0 24px',height:32,cursor:'pointer',color: folder===f.key&&!searchActive?'#001d35':'#444746',fontSize:14,fontWeight:folder===f.key&&!searchActive?700:400,marginRight:8 }}>
            <GIcon name={f.key} size={20} color={folder===f.key&&!searchActive?'#001d35':'#444746'} />
            <span style={{ flex:1 }}>{f.label}</span>
          </div>
        ))}
        <div style={{ padding:'16px 24px 4px',fontSize:12,fontWeight:500,color:'#444746',letterSpacing:0.4,textTransform:'uppercase' }}>Categories</div>
        {CATEGORIES.map(f => (
          <div key={f.key} onClick={() => pickFolder(f)} className={`gi-sb ${folder===f.key?'gi-sb-active':''}`}
            style={{ display:'flex',alignItems:'center',gap:12,padding:'0 24px',height:32,cursor:'pointer',color:folder===f.key?'#001d35':'#444746',fontSize:14,fontWeight:folder===f.key?700:400,marginRight:8 }}>
            <GIcon name={f.key} size={20} color={folder===f.key?'#001d35':'#444746'} />
            <span>{f.label}</span>
          </div>
        ))}
      </div>

      {/* Main */}
      <div style={{ flex:1,display:'flex',flexDirection:'column',minWidth:0,background:'#fff',borderRadius:'16px 0 0 16px',marginLeft:-1 }}>

        {/* Search */}
        <div style={{ padding:'6px 8px 2px 16px',display:'flex',alignItems:'center',gap:8 }}>
          <div style={{ flex:1,display:'flex',alignItems:'center',background:searchActive?'#fff':'#eaf1fb',borderRadius:28,padding:'0 12px',height:48,border:searchActive?'1px solid #c7c7c7':'1px solid transparent',boxShadow:searchActive?'0 1px 3px rgba(0,0,0,.15)':'none',transition:'box-shadow .2s,border .2s' }}>
            <GIcon name="search" size={20} color="#5f6368" />
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
              onFocus={() => setSearchActive(true)} onBlur={() => setTimeout(() => setSearchActive(false), 200)}
              onKeyDown={e => { if (e.key === 'Enter') doSearch(search); if (e.key === 'Escape') { setSearch(''); setSearchActive(false); load(folder); } }}
              placeholder="Search mail"
              style={{ flex:1,border:'none',background:'transparent',outline:'none',fontSize:16,padding:'0 12px',color:'#202124',fontFamily:'inherit' }} />
            {search && <div onClick={() => { setSearch(''); load(folder); }} style={{ cursor:'pointer',padding:4,borderRadius:'50%',display:'flex' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="#5f6368"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></div>}
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display:'flex',alignItems:'center',padding:'0 8px 0 16px',height:40,borderBottom:'1px solid #f1f3f4',gap:2 }}>
          <div onClick={() => { const all=checkedIds.size===messages.length; setCheckedIds(all?new Set():new Set(messages.map(m=>m.id))); }} style={{ width:18,height:18,border:checkedIds.size?'none':'2px solid #c4c7c5',borderRadius:2,background:checkedIds.size?'#1a73e8':'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',marginRight:8 }}>
            {checkedIds.size>0 && <span style={{ color:'#fff',fontSize:11,fontWeight:700 }}>✓</span>}
          </div>
          <div onClick={() => load(folder, search)} style={{ padding:8,borderRadius:'50%',cursor:'pointer',display:'flex' }} className="gi-row">
            <GIcon name="refresh" size={20} />
          </div>
          {checkedIds.size > 0 && (
            <div style={{ display:'flex',alignItems:'center',gap:8,marginLeft:8 }}>
              <span style={{ fontSize:13,color:'#202124',fontWeight:500 }}>{checkedIds.size} selected</span>
              <div onClick={bulkPushToQueue}
                style={{ display:'flex',alignItems:'center',gap:6,padding:'4px 16px',background:'#1a73e8',color:'#fff',borderRadius:16,cursor:'pointer',fontSize:13,fontWeight:500 }}
                onMouseEnter={e => e.currentTarget.style.background='#1557b0'}
                onMouseLeave={e => e.currentTarget.style.background='#1a73e8'}>
                <GIcon name="SENT" size={16} color="#fff" /> Push to Queue
              </div>
              <div onClick={() => setCheckedIds(new Set())}
                style={{ padding:'4px 12px',border:'1px solid #dadce0',borderRadius:16,cursor:'pointer',fontSize:13,color:'#5f6368' }}
                onMouseEnter={e => e.currentTarget.style.background='#f1f3f4'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                Cancel
              </div>
            </div>
          )}
          
          <div style={{ flex:1 }} />
          <span style={{ fontSize:12,color:'#5f6368',padding:'0 8px' }}>{messages.length?'1–'+messages.length:'0'}{total>messages.length?' of many':''}</span>
          {nextPage && <div onClick={() => load(folder,search,nextPage)} style={{ padding:8,borderRadius:'50%',cursor:'pointer',display:'flex' }} className="gi-row"><GIcon name="chevRight" /></div>}
        </div>

        {/* Content */}
        {!selected ? (
          <div ref={listRef} onScroll={onScroll} style={{ flex:1,overflowY:'auto',overflowX:'hidden' }}>
            {loading && Array.from({length:12}).map((_,i) => (
              <div key={i} style={{ display:'flex',alignItems:'center',gap:12,padding:'0 16px',height:40,borderBottom:'1px solid #f6f6f6' }}>
                <div className="gi-skel" style={{ width:18,height:18 }} />
                <div className="gi-skel" style={{ width:18,height:18 }} />
                <div className="gi-skel" style={{ width:120+Math.random()*80,height:12 }} />
                <div className="gi-skel" style={{ flex:1,height:12 }} />
                <div className="gi-skel" style={{ width:50,height:12 }} />
              </div>
            ))}
            {!loading && messages.length === 0 && (
              <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'60%',color:'#5f6368' }}>
                <svg width="80" height="80" viewBox="0 0 24 24" fill="#dadce0"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                <div style={{ marginTop:12,fontSize:14 }}>Nothing here</div>
              </div>
            )}
            {!loading && messages.map(m => (
              <div key={m.id} className="gi-row" onClick={() => openMsg(m)}
                style={{ display:'flex',alignItems:'center',padding:'0 16px',height:40,cursor:'pointer',borderBottom:'1px solid #f6f6f6',background:checkedIds.has(m.id)?'#c2dbff':m.isUnread?'#f2f6fc':'#fff' }}>
                <div onClick={e => { e.stopPropagation(); setCheckedIds(prev => { const n=new Set(prev); n.has(m.id)?n.delete(m.id):n.add(m.id); return n; }); }}
                  style={{ width:18,height:18,border:checkedIds.has(m.id)?'none':'2px solid #c4c7c5',borderRadius:2,background:checkedIds.has(m.id)?'#1a73e8':'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0,marginRight:8 }}>
                  {checkedIds.has(m.id) && <span style={{ color:'#fff',fontSize:11,fontWeight:700 }}>✓</span>}
                </div>
                <div onClick={e => e.stopPropagation()} style={{ color:m.labels?.includes('STARRED')?'#f4b400':'#dadce0',cursor:'pointer',marginRight:8,fontSize:18,lineHeight:1,flexShrink:0 }}>
                  {m.labels?.includes('STARRED')?'★':'☆'}
                </div>
                <span style={{ width:200,flexShrink:0,fontSize:14,fontWeight:m.isUnread?700:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:8 }}>
                  {senderName(m.from)}
                </span>
                <div style={{ flex:1,display:'flex',alignItems:'baseline',overflow:'hidden',minWidth:0,gap:4 }}>
                  <span style={{ fontWeight:m.isUnread?700:400,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'45%',flexShrink:1 }}>{m.subject||'(no subject)'}</span>
                  <span style={{ color:'#5f6368',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flexShrink:1 }}>{m.snippet ? '— '+m.snippet : ''}</span>
                </div>
                {m.hasAttachment && <GIcon name="attach" size={16} color="#5f6368" />}
                <span style={{ flexShrink:0,marginLeft:12,fontSize:12,color:m.isUnread?'#202124':'#5f6368',fontWeight:m.isUnread?700:400,whiteSpace:'nowrap' }}>{fmtDate(m.date)}</span>
              </div>
            ))}
            {loadingMore && <div style={{ padding:16,textAlign:'center',color:'#5f6368',fontSize:13 }}>Loading more…</div>}
          </div>
        ) : (
          <div style={{ flex:1,overflowY:'auto' }}>
            <div style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 16px',borderBottom:'1px solid #f1f3f4' }}>
              <div onClick={() => { setSelected(null); setDetail(null); }} style={{ padding:8,borderRadius:'50%',cursor:'pointer',display:'flex' }} className="gi-row"><GIcon name="back" /></div>
              <span style={{ fontSize:14,color:'#5f6368' }}>Back</span>
            </div>
            {detailLoading ? (
              <div style={{ padding:40,textAlign:'center' }}><div style={{ width:36,height:36,border:'3px solid #e8eaed',borderTopColor:'#1a73e8',borderRadius:'50%',animation:'shimmer .8s linear infinite',margin:'0 auto' }} /></div>
            ) : detail && (
              <div style={{ maxWidth:880,margin:'0 auto',padding:'0 24px' }}>
                <h1 style={{ fontSize:22,fontWeight:400,color:'#202124',margin:'20px 0 16px',lineHeight:1.35 }}>{detail.subject||'(no subject)'}</h1>
                <div style={{ display:'flex',gap:12,marginBottom:20 }}>
                  <div style={{ width:40,height:40,borderRadius:'50%',background:'#1a73e8',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:18,fontWeight:500,flexShrink:0 }}>
                    {(senderName(detail.from)||'?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div><span style={{ fontWeight:500 }}>{senderName(detail.from)}</span> <span style={{ color:'#5f6368',fontSize:12 }}>&lt;{senderEmail(detail.from)}&gt;</span></div>
                    <div style={{ fontSize:12,color:'#5f6368' }}>to {detail.to?senderName(detail.to):'me'}</div>
                  </div>
                  <span style={{ fontSize:12,color:'#5f6368',flexShrink:0 }}>{detail.date?new Date(detail.date).toLocaleString():''}</span>
                </div>
                <div style={{ padding:'0 0 16px 52px',fontSize:14,lineHeight:1.6,wordBreak:'break-word' }} dangerouslySetInnerHTML={{ __html: detail.body }} />
                {detail.attachments?.length > 0 && (
                  <div style={{ padding:'0 0 16px 52px',display:'flex',flexWrap:'wrap',gap:8 }}>
                    {detail.attachments.map((a,i) => (
                      <a key={i} href={a.url} target="_blank" rel="noopener" style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 12px',border:'1px solid #dadce0',borderRadius:8,color:'#202124',textDecoration:'none',fontSize:13,background:'#fff' }} className="gi-row">
                        <GIcon name="attach" size={18} />
                        <span style={{ maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{a.filename}</span>
                        {a.size>0 && <span style={{ color:'#5f6368',fontSize:11 }}>{a.size>1048576?(a.size/1048576).toFixed(1)+'MB':Math.round(a.size/1024)+'KB'}</span>}
                      </a>
                    ))}
                  </div>
                )}
                {!showReply ? (
                  <div style={{ padding:'8px 0 32px 52px' }}>
                    <div onClick={() => setShowReply(true)} style={{ display:'inline-flex',alignItems:'center',gap:8,padding:'8px 24px',border:'1px solid #dadce0',borderRadius:18,cursor:'pointer',fontSize:14,color:'#202124' }} className="gi-row">
                      <GIcon name="reply" size={18} /> Reply
                    </div>
                    <div onClick={async () => {
                      try {
                        const d = await api.pushToQueue(selected.id);
                        showToast?.('Pushed to queue: ' + (d.subject||''));
                        setMessages(prev => prev.filter(m => m.id !== selected.id));
                        setSelected(null); setDetail(null);
                        if (refreshCounts) refreshCounts();
                      } catch(e) { showToast?.(e.message || 'Failed to push'); }
                    }} style={{ display:'inline-flex',alignItems:'center',gap:8,padding:'8px 24px',border:'1px solid #dadce0',borderRadius:18,cursor:'pointer',fontSize:14,color:'#1a73e8',marginLeft:8 }} className="gi-row">
                      Push to Queue
                    </div>
                  </div>
                ) : (
                  <div style={{ margin:'0 0 32px 52px',border:'1px solid #dadce0',borderRadius:8,overflow:'hidden' }}>
                    <div style={{ padding:'8px 16px',borderBottom:'1px solid #f1f3f4',fontSize:12,color:'#5f6368' }}>To: {detail.from}</div>
                    <textarea value={replyBody} onChange={e => setReplyBody(e.target.value)} rows={6} autoFocus
                      style={{ width:'100%',border:'none',outline:'none',padding:'12px 16px',fontSize:14,lineHeight:1.5,resize:'vertical',boxSizing:'border-box',fontFamily:'inherit' }} placeholder="Type your reply…" />
                    <div style={{ padding:'8px 16px',background:'#f6f8fc',display:'flex',gap:8 }}>
                      <button onClick={sendReply} disabled={sending} style={{ padding:'8px 24px',background:'#0b57d0',color:'#fff',border:'none',borderRadius:18,cursor:sending?'default':'pointer',fontSize:14,fontWeight:500,opacity:sending?.7:1 }}>{sending?'Sending…':'Send'}</button>
                      <div onClick={() => { setShowReply(false); setReplyBody(''); }} style={{ padding:8,borderRadius:'50%',cursor:'pointer',display:'flex' }} className="gi-row"><GIcon name="TRASH" size={18} /></div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
