import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d), now = new Date();
  if (dt.toDateString() === now.toDateString()) return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dt.getFullYear() === now.getFullYear()) return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return dt.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function senderName(f) { if (!f) return ''; const m = f.match(/^"?([^"<]+)/); return m ? m[1].trim() : f.split('@')[0]; }
function senderEmail(f) { if (!f) return ''; const m = f.match(/<([^>]+)>/); return m ? m[1] : f; }

const SYSTEM_FOLDERS = [
  { id: 'INBOX', label: 'Inbox', icon: 'inbox' },
  { id: 'STARRED', label: 'Starred', icon: 'star' },
  { id: 'SNOOZED', label: 'Snoozed', icon: 'clock' },
  { id: 'IMPORTANT', label: 'Important', icon: 'alert' },
  { id: 'SENT', label: 'Sent', icon: 'send' },
  { id: 'DRAFT', label: 'Drafts', icon: 'file' },
  { id: 'ALL', label: 'All Mail', icon: 'mail' },
  { id: 'SPAM', label: 'Spam', icon: 'alert' },
  { id: 'TRASH', label: 'Trash', icon: 'trash' },
];
const CATEGORY_TABS = [
  { id: 'CATEGORY_PERSONAL', label: 'Primary', q: 'category:primary' },
  { id: 'CATEGORY_SOCIAL', label: 'Social', q: 'category:social' },
  { id: 'CATEGORY_PROMOTIONS', label: 'Promotions', q: 'category:promotions' },
  { id: 'CATEGORY_UPDATES', label: 'Updates', q: 'category:updates' },
];

const SvgIcon = ({ d, size = 20, color = '#444746' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d={d}/></svg>
);

const ICON_PATHS = {
  inbox: "M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm0 16H5v-6h3.56c.69 1.19 1.97 2 3.44 2s2.75-.81 3.44-2H19v6zm0-8h-4.18C14.4 12.16 13.27 13 12 13s-2.4-.84-2.82-2H5V5h14v6z",
  star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  clock: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z",
  alert: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
  file: "M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z",
  mail: "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
  trash: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  search: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  refresh: "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  attach: "M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 006 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z",
  reply: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  compose: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  label: "M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z",
};

export default function PersonalInbox({ currentUser, showToast, refreshCounts }) {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [folder, setFolder] = useState('INBOX');
  const [categoryTab, setCategoryTab] = useState('CATEGORY_PERSONAL');
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
  const [labels, setLabels] = useState([]);
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeSending, setComposeSending] = useState(false);
  const ran = useRef(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    api.gmailStatus().then(s => {
      setConnected(s.connected);
      if (s.connected) {
        load('INBOX');
        api.getGmailLabels().then(d => setLabels(d.labels || [])).catch(() => {});
      } else setLoading(false);
    }).catch(() => setLoading(false));
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

  const pickFolder = (id) => { setFolder(id); setSelected(null); setDetail(null); setCheckedIds(new Set()); setSearch(''); setSearchActive(false); load(id); };
  const pickCategory = (cat) => { setCategoryTab(cat.id); setSelected(null); setDetail(null); load('INBOX', cat.q); };
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

  const sendCompose = async () => {
    if (!composeTo.trim() || !composeBody.trim()) return;
    setComposeSending(true);
    try {
      await api.gmailPersonalSend({ to: composeTo, subject: composeSubject, body: composeBody });
      showToast?.('Message sent');
      setShowCompose(false); setComposeTo(''); setComposeSubject(''); setComposeBody('');
    } catch(e) { showToast?.(e.message); }
    setComposeSending(false);
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

  const getLabelCount = (id) => {
    const l = labels.find(l => l.id === id);
    return l ? l.unread : 0;
  };

  const userLabels = labels.filter(l => l.type === 'user' && !l.name.startsWith('CareCoord'));

  const onScroll = () => {
    if (!listRef.current || !nextPage || loadingMore) return;
    const el = listRef.current;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) load(folder, search, nextPage);
  };

  const isSupervisorOrAdmin = currentUser?.role === 'supervisor' || currentUser?.role === 'admin';

  if (!connected) return (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100%',background:'#fff' }}>
      <div style={{ textAlign:'center',color:'#5f6368' }}>
        <SvgIcon d={ICON_PATHS.mail} size={64} color="#dadce0" />
        <p style={{ fontSize:14,margin:'16px 0 0' }}>Connect Google Workspace to view email</p>
      </div>
    </div>
  );

  const css = `
    .gi-row:hover { background: #f2f2f2 !important; }
    .gi-sb:hover { background: #e8eaed; border-radius: 0 16px 16px 0; }
    .gi-sb-active { background: #d3e3fd !important; border-radius: 0 16px 16px 0 !important; font-weight: 700 !important; color: #001d35 !important; }
    .gi-tab { padding: 12px 16px; cursor: pointer; font-size: 14px; font-weight: 500; color: #444746; border-bottom: 3px solid transparent; display: flex; align-items: center; gap: 8px; }
    .gi-tab:hover { background: #f2f6fc; }
    .gi-tab-active { color: #0b57d0; border-bottom-color: #0b57d0; font-weight: 700; }
    @keyframes shimmer { 0%{background-position:-600px 0} 100%{background-position:600px 0} }
    .gi-skel { background: linear-gradient(90deg,#f6f6f6 25%,#efefef 50%,#f6f6f6 75%); background-size:600px; animation: shimmer 1.5s infinite; border-radius:2px; }
    * { box-sizing: border-box; }
  `;

  return (
    <div style={{ display:'flex',height:'100%',background:'#fff',fontFamily:"'Google Sans',Roboto,-apple-system,sans-serif",fontSize:14,color:'#202124' }}>
      <style>{css}</style>

      {/* Sidebar */}
      <div style={{ width:256,flexShrink:0,background:'#f6f8fc',paddingTop:4,overflowY:'auto',overflowX:'hidden',display:'flex',flexDirection:'column' }}>
        {/* Compose Button */}
        <div style={{ padding:'8px 12px 12px' }}>
          <button onClick={() => setShowCompose(true)}
            style={{ display:'flex',alignItems:'center',gap:10,padding:'14px 24px',background:'#c2e7ff',border:'none',borderRadius:16,cursor:'pointer',fontSize:14,fontWeight:500,color:'#001d35',boxShadow:'0 1px 3px rgba(0,0,0,.1)',width:'auto' }}
            onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 8px rgba(0,0,0,.2)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,.1)'}>
            <SvgIcon d={ICON_PATHS.compose} size={24} color="#001d35" />
            Compose
          </button>
        </div>

        {/* System Folders */}
        {SYSTEM_FOLDERS.map(f => {
          const unread = getLabelCount(f.id);
          return (
            <div key={f.id} onClick={() => pickFolder(f.id)}
              className={`gi-sb ${folder === f.id && !searchActive ? 'gi-sb-active' : ''}`}
              style={{ display:'flex',alignItems:'center',gap:12,padding:'0 24px',height:32,cursor:'pointer',color:folder===f.id?'#001d35':'#444746',fontSize:14,fontWeight:folder===f.id?700:400,marginRight:8 }}>
              <SvgIcon d={ICON_PATHS[f.icon]} size={20} color={folder===f.id?'#001d35':'#444746'} />
              <span style={{ flex:1 }}>{f.label}</span>
              {unread > 0 && <span style={{ fontSize:12,fontWeight:700,color:folder===f.id?'#001d35':'#444746' }}>{unread}</span>}
            </div>
          );
        })}

        {/* Categories */}
        <div style={{ padding:'16px 24px 4px',fontSize:11,fontWeight:500,color:'#444746',letterSpacing:0.4,textTransform:'uppercase' }}>Categories</div>
        {CATEGORY_TABS.map(c => (
          <div key={c.id} onClick={() => pickCategory(c)}
            className={`gi-sb ${folder === c.id ? 'gi-sb-active' : ''}`}
            style={{ display:'flex',alignItems:'center',gap:12,padding:'0 24px',height:32,cursor:'pointer',color:folder===c.id?'#001d35':'#444746',fontSize:14,fontWeight:folder===c.id?700:400,marginRight:8 }}>
            <span style={{ flex:1 }}>{c.label}</span>
            {getLabelCount(c.id) > 0 && <span style={{ fontSize:12,fontWeight:700 }}>{getLabelCount(c.id)}</span>}
          </div>
        ))}

        {/* User Labels */}
        {userLabels.length > 0 && (
          <>
            <div style={{ padding:'16px 24px 4px',fontSize:11,fontWeight:500,color:'#444746',letterSpacing:0.4,textTransform:'uppercase' }}>Labels</div>
            {userLabels.map(l => (
              <div key={l.id} onClick={() => { setFolder(l.id); setSelected(null); setDetail(null); load('ALL', 'label:' + l.name.replace(/ /g, '-')); }}
                className="gi-sb"
                style={{ display:'flex',alignItems:'center',gap:12,padding:'0 24px',height:32,cursor:'pointer',color:'#444746',fontSize:14,marginRight:8 }}>
                <SvgIcon d={ICON_PATHS.label} size={18} color="#444746" />
                <span style={{ flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{l.name}</span>
                {l.unread > 0 && <span style={{ fontSize:12,fontWeight:700 }}>{l.unread}</span>}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Main */}
      <div style={{ flex:1,display:'flex',flexDirection:'column',minWidth:0,background:'#fff' }}>
        {/* Search */}
        <div style={{ padding:'6px 8px 2px 16px',display:'flex',alignItems:'center',gap:8 }}>
          <div style={{ flex:1,display:'flex',alignItems:'center',background:searchActive?'#fff':'#eaf1fb',borderRadius:28,padding:'0 12px',height:48,border:searchActive?'1px solid #c7c7c7':'1px solid transparent',boxShadow:searchActive?'0 1px 3px rgba(0,0,0,.15)':'none' }}>
            <SvgIcon d={ICON_PATHS.search} size={20} color="#5f6368" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              onFocus={() => setSearchActive(true)} onBlur={() => setTimeout(() => setSearchActive(false), 200)}
              onKeyDown={e => { if (e.key === 'Enter') doSearch(search); if (e.key === 'Escape') { setSearch(''); setSearchActive(false); load(folder); } }}
              placeholder="Search mail"
              style={{ flex:1,border:'none',background:'transparent',outline:'none',fontSize:16,padding:'0 12px',color:'#202124',fontFamily:'inherit' }} />
            {search && <div onClick={() => { setSearch(''); load(folder); }} style={{ cursor:'pointer',padding:4,borderRadius:'50%',display:'flex' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="#5f6368"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></div>}
          </div>
        </div>

        {/* Tabs for Inbox */}
        {folder === 'INBOX' && !selected && (
          <div style={{ display:'flex',borderBottom:'1px solid #f1f3f4' }}>
            {CATEGORY_TABS.map(t => (
              <div key={t.id} onClick={() => pickCategory(t)} className={`gi-tab ${categoryTab === t.id ? 'gi-tab-active' : ''}`}>
                {t.label}
                {getLabelCount(t.id) > 0 && <span style={{ fontSize:11,fontWeight:700,color:categoryTab===t.id?'#0b57d0':'#5f6368',background:categoryTab===t.id?'#d3e3fd':'#e8eaed',padding:'1px 6px',borderRadius:8 }}>{getLabelCount(t.id)}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div style={{ display:'flex',alignItems:'center',padding:'0 8px 0 16px',height:40,borderBottom:'1px solid #f1f3f4',gap:2 }}>
          <div onClick={() => { const all=checkedIds.size===messages.length; setCheckedIds(all?new Set():new Set(messages.map(m=>m.id))); }}
            style={{ width:18,height:18,border:checkedIds.size?'none':'2px solid #c4c7c5',borderRadius:2,background:checkedIds.size?'#1a73e8':'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',marginRight:8 }}>
            {checkedIds.size > 0 && <span style={{ color:'#fff',fontSize:11,fontWeight:700 }}>&#10003;</span>}
          </div>
          <div onClick={() => load(folder, search)} style={{ padding:8,borderRadius:'50%',cursor:'pointer',display:'flex' }} className="gi-row">
            <SvgIcon d={ICON_PATHS.refresh} />
          </div>
          {checkedIds.size > 0 && isSupervisorOrAdmin && (
            <div style={{ display:'flex',alignItems:'center',gap:8,marginLeft:8 }}>
              <span style={{ fontSize:13,color:'#202124',fontWeight:500 }}>{checkedIds.size} selected</span>
              <div onClick={bulkPushToQueue}
                style={{ display:'flex',alignItems:'center',gap:6,padding:'4px 16px',background:'#1a73e8',color:'#fff',borderRadius:16,cursor:'pointer',fontSize:13,fontWeight:500 }}>
                Push to Queue
              </div>
              <div onClick={() => setCheckedIds(new Set())}
                style={{ padding:'4px 12px',border:'1px solid #dadce0',borderRadius:16,cursor:'pointer',fontSize:13,color:'#5f6368' }}>
                Cancel
              </div>
            </div>
          )}
          <div style={{ flex:1 }} />
          <span style={{ fontSize:12,color:'#5f6368',padding:'0 8px' }}>{messages.length ? '1\u2013' + messages.length : '0'}{total > messages.length ? ' of many' : ''}</span>
        </div>

        {/* Message List or Detail */}
        {!selected ? (
          <div ref={listRef} onScroll={onScroll} style={{ flex:1,overflowY:'auto' }}>
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
                <SvgIcon d={ICON_PATHS.mail} size={80} color="#dadce0" />
                <div style={{ marginTop:12,fontSize:14 }}>Nothing here</div>
              </div>
            )}
            {!loading && messages.map(m => (
              <div key={m.id} className="gi-row" onClick={() => openMsg(m)}
                style={{ display:'flex',alignItems:'center',padding:'0 16px',height:40,cursor:'pointer',borderBottom:'1px solid #f6f6f6',background:checkedIds.has(m.id)?'#c2dbff':m.isUnread?'#f2f6fc':'#fff' }}>
                <div onClick={e => { e.stopPropagation(); setCheckedIds(prev => { const n = new Set(prev); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; }); }}
                  style={{ width:18,height:18,border:checkedIds.has(m.id)?'none':'2px solid #c4c7c5',borderRadius:2,background:checkedIds.has(m.id)?'#1a73e8':'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0,marginRight:8 }}>
                  {checkedIds.has(m.id) && <span style={{ color:'#fff',fontSize:11,fontWeight:700 }}>&#10003;</span>}
                </div>
                <div onClick={e => e.stopPropagation()} style={{ color:m.labels?.includes('STARRED')?'#f4b400':'#dadce0',cursor:'pointer',marginRight:8,fontSize:18,lineHeight:1,flexShrink:0 }}>
                  {m.labels?.includes('STARRED') ? '\u2605' : '\u2606'}
                </div>
                <span style={{ width:200,flexShrink:0,fontSize:14,fontWeight:m.isUnread?700:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:8 }}>
                  {senderName(m.from)}
                </span>
                <div style={{ flex:1,display:'flex',alignItems:'baseline',overflow:'hidden',minWidth:0,gap:4 }}>
                  <span style={{ fontWeight:m.isUnread?700:400,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'45%' }}>{m.subject || '(no subject)'}</span>
                  <span style={{ color:'#5f6368',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{m.snippet ? '\u2014 ' + m.snippet : ''}</span>
                </div>
                {m.hasAttachment && <SvgIcon d={ICON_PATHS.attach} size={16} color="#5f6368" />}
                <span style={{ flexShrink:0,marginLeft:12,fontSize:12,color:m.isUnread?'#202124':'#5f6368',fontWeight:m.isUnread?700:400,whiteSpace:'nowrap' }}>{fmtDate(m.date)}</span>
              </div>
            ))}
            {loadingMore && <div style={{ padding:16,textAlign:'center',color:'#5f6368',fontSize:13 }}>Loading more...</div>}
          </div>
        ) : (
          <div style={{ flex:1,overflowY:'auto' }}>
            <div style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 16px',borderBottom:'1px solid #f1f3f4' }}>
              <div onClick={() => { setSelected(null); setDetail(null); }} style={{ padding:8,borderRadius:'50%',cursor:'pointer',display:'flex' }} className="gi-row">
                <SvgIcon d={ICON_PATHS.back} />
              </div>
              <span style={{ fontSize:14,color:'#5f6368' }}>Back</span>
            </div>
            {detailLoading ? (
              <div style={{ padding:40,textAlign:'center',color:'#5f6368' }}>Loading...</div>
            ) : detail && (
              <div style={{ maxWidth:880,margin:'0 auto',padding:'0 24px' }}>
                <h1 style={{ fontSize:22,fontWeight:400,color:'#202124',margin:'20px 0 16px',lineHeight:1.35 }}>{detail.subject || '(no subject)'}</h1>
                <div style={{ display:'flex',gap:12,marginBottom:20 }}>
                  <div style={{ width:40,height:40,borderRadius:'50%',background:'#1a73e8',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:18,fontWeight:500,flexShrink:0 }}>
                    {(senderName(detail.from) || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div><span style={{ fontWeight:500 }}>{senderName(detail.from)}</span> <span style={{ color:'#5f6368',fontSize:12 }}>&lt;{senderEmail(detail.from)}&gt;</span></div>
                    <div style={{ fontSize:12,color:'#5f6368' }}>to {detail.to ? senderName(detail.to) : 'me'}</div>
                  </div>
                  <span style={{ fontSize:12,color:'#5f6368',flexShrink:0 }}>{detail.date ? new Date(detail.date).toLocaleString() : ''}</span>
                </div>
                <div style={{ padding:'0 0 16px 52px',fontSize:14,lineHeight:1.6,wordBreak:'break-word' }} dangerouslySetInnerHTML={{ __html: detail.body }} />
                {detail.attachments?.length > 0 && (
                  <div style={{ padding:'0 0 16px 52px',display:'flex',flexWrap:'wrap',gap:8 }}>
                    {detail.attachments.map((a, i) => (
                      <a key={i} href={a.url} target="_blank" rel="noopener" style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 12px',border:'1px solid #dadce0',borderRadius:8,color:'#202124',textDecoration:'none',fontSize:13 }} className="gi-row">
                        <SvgIcon d={ICON_PATHS.attach} size={18} />
                        <span style={{ maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{a.filename}</span>
                      </a>
                    ))}
                  </div>
                )}
                {!showReply ? (
                  <div style={{ padding:'8px 0 32px 52px',display:'flex',gap:8 }}>
                    <div onClick={() => setShowReply(true)} style={{ display:'inline-flex',alignItems:'center',gap:8,padding:'8px 24px',border:'1px solid #dadce0',borderRadius:18,cursor:'pointer',fontSize:14 }} className="gi-row">
                      <SvgIcon d={ICON_PATHS.reply} size={18} /> Reply
                    </div>
                    {isSupervisorOrAdmin && (
                      <div onClick={async () => {
                        try {
                          const d = await api.pushToQueue(selected.id);
                          showToast?.('Pushed to queue: ' + (d.subject || ''));
                          setMessages(prev => prev.filter(m => m.id !== selected.id));
                          setSelected(null); setDetail(null);
                          if (refreshCounts) refreshCounts();
                        } catch(e) { showToast?.(e.message || 'Failed'); }
                      }} style={{ display:'inline-flex',alignItems:'center',gap:8,padding:'8px 24px',border:'1px solid #dadce0',borderRadius:18,cursor:'pointer',fontSize:14,color:'#1a73e8' }} className="gi-row">
                        Push to Queue
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ margin:'0 0 32px 52px',border:'1px solid #dadce0',borderRadius:8,overflow:'hidden' }}>
                    <div style={{ padding:'8px 16px',borderBottom:'1px solid #f1f3f4',fontSize:12,color:'#5f6368' }}>To: {detail.from}</div>
                    <textarea value={replyBody} onChange={e => setReplyBody(e.target.value)} rows={6} autoFocus
                      style={{ width:'100%',border:'none',outline:'none',padding:'12px 16px',fontSize:14,lineHeight:1.5,resize:'vertical',boxSizing:'border-box',fontFamily:'inherit' }} placeholder="Type your reply..." />
                    <div style={{ padding:'8px 16px',background:'#f6f8fc',display:'flex',gap:8 }}>
                      <button onClick={sendReply} disabled={sending} style={{ padding:'8px 24px',background:'#0b57d0',color:'#fff',border:'none',borderRadius:18,cursor:sending?'default':'pointer',fontSize:14,fontWeight:500,opacity:sending?.7:1 }}>{sending ? 'Sending...' : 'Send'}</button>
                      <div onClick={() => { setShowReply(false); setReplyBody(''); }} style={{ padding:8,borderRadius:'50%',cursor:'pointer',display:'flex' }} className="gi-row">
                        <SvgIcon d={ICON_PATHS.trash} size={18} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <div style={{ position:'fixed',bottom:0,right:24,width:480,background:'#fff',borderRadius:'12px 12px 0 0',boxShadow:'0 -4px 20px rgba(0,0,0,.2)',zIndex:100,display:'flex',flexDirection:'column',maxHeight:'60vh' }}>
          <div style={{ display:'flex',alignItems:'center',padding:'8px 12px',background:'#404040',borderRadius:'12px 12px 0 0',color:'#fff' }}>
            <span style={{ flex:1,fontSize:14,fontWeight:500 }}>New Message</span>
            <div onClick={() => setShowCompose(false)} style={{ cursor:'pointer',padding:4 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </div>
          </div>
          <div style={{ padding:'4px 12px',borderBottom:'1px solid #f1f3f4' }}>
            <input value={composeTo} onChange={e => setComposeTo(e.target.value)} placeholder="Recipients"
              style={{ width:'100%',border:'none',outline:'none',fontSize:14,padding:'8px 0',fontFamily:'inherit' }} />
          </div>
          <div style={{ padding:'4px 12px',borderBottom:'1px solid #f1f3f4' }}>
            <input value={composeSubject} onChange={e => setComposeSubject(e.target.value)} placeholder="Subject"
              style={{ width:'100%',border:'none',outline:'none',fontSize:14,padding:'8px 0',fontFamily:'inherit' }} />
          </div>
          <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)} rows={8}
            style={{ flex:1,border:'none',outline:'none',padding:'12px',fontSize:14,lineHeight:1.5,resize:'none',fontFamily:'inherit' }} placeholder="Compose email" />
          <div style={{ padding:'8px 12px',display:'flex',gap:8,borderTop:'1px solid #f1f3f4' }}>
            <button onClick={sendCompose} disabled={composeSending}
              style={{ padding:'8px 24px',background:'#0b57d0',color:'#fff',border:'none',borderRadius:18,cursor:composeSending?'default':'pointer',fontSize:14,fontWeight:500 }}>
              {composeSending ? 'Sending...' : 'Send'}
            </button>
            <div onClick={() => setShowCompose(false)} style={{ padding:8,borderRadius:'50%',cursor:'pointer',display:'flex',marginLeft:'auto' }}>
              <SvgIcon d={ICON_PATHS.trash} size={18} color="#5f6368" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
