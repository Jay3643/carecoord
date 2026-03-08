import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

export default function DrivePanel({ showToast }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState('');
  const [stack, setStack] = useState([{ id: null, name: 'My Drive' }]);
  const [view, setView] = useState('my');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    api.gmailStatus().then(s => { setConnected(s.connected); if (s.connected) load(); else setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const load = (fid, q) => { setLoading(true); api.driveFiles(q||'', fid||null).then(d => setFiles(d.files||[])).catch(() => {}).finally(() => setLoading(false)); };
  const loadShared = () => { setLoading(true); api.driveShared().then(d => setFiles(d.files||[])).catch(() => {}).finally(() => setLoading(false)); };
  const openFolder = f => { setStack(s => [...s, { id: f.id, name: f.name }]); load(f.id); };
  const goBack = i => { const ns = stack.slice(0, i+1); setStack(ns); load(ns[ns.length-1].id); };
  const switchView = v => { setView(v); if (v==='my') { setStack([{id:null,name:'My Drive'}]); load(); } else loadShared(); };
  const doSearch = e => { e.preventDefault(); if(search) { setView('search'); load(null,search); } };
  const icon = m => { if(m==='application/vnd.google-apps.folder') return '📁'; if(m?.includes('spreadsheet')) return '📊'; if(m?.includes('document')) return '📄'; if(m?.includes('pdf')) return '📕'; if(m?.includes('image')) return '🖼️'; return '📎'; };
  const fmt = b => { if(!b) return ''; if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB'; };
  const btn = (bg,fg) => ({ padding:'8px 16px', background:bg, color:fg, border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600 });
  const tab = a => ({ padding:'8px 16px', background:a?'#1a5e9a':'transparent', color:a?'#fff':'#1e3a4f', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:a?600:400 });
  const inp = { width:'100%', padding:'8px', background:'#f0f4f9', border:'1px solid #c0d0e4', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box' };

  if (!connected) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:12}}><h2 style={{fontSize:18,fontWeight:700}}>Google Drive</h2><p style={{fontSize:13,color:'#6b8299'}}>Connect Google Workspace to browse files.</p></div>;

  return (<div style={{display:'flex',flexDirection:'column',height:'100%'}}>
    <div style={{padding:'12px 24px',borderBottom:'1px solid #c0d0e4'}}>
      <div style={{display:'flex',gap:4,marginBottom:8}}><button onClick={()=>switchView('my')} style={tab(view==='my')}>My Drive</button><button onClick={()=>switchView('shared')} style={tab(view==='shared')}>Shared</button></div>
      <form onSubmit={doSearch} style={{display:'flex',gap:8}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search files..." style={{...inp,flex:1}} /><button type="submit" style={btn('#dde8f2','#1e3a4f')}>Search</button></form>
    </div>
    {view==='my' && stack.length>1 && <div style={{padding:'6px 24px',background:'#f0f4f9',borderBottom:'1px solid #c0d0e4',display:'flex',gap:4,fontSize:12}}>
      {stack.map((f,i) => <span key={i}>{i>0&&<span style={{margin:'0 4px',color:'#c0d0e4'}}>/</span>}<button onClick={()=>goBack(i)} style={{background:'none',border:'none',cursor:'pointer',color:i===stack.length-1?'#1e3a4f':'#1a5e9a',fontWeight:i===stack.length-1?600:400,fontSize:12}}>{f.name}</button></span>)}
    </div>}
    <div style={{flex:1,overflow:'auto',padding:16}}>
      {loading && <div style={{color:'#6b8299',textAlign:'center',padding:20}}>Loading...</div>}
      {!loading && files.length===0 && <div style={{color:'#6b8299',textAlign:'center',padding:40}}>No files</div>}
      {files.map(f => <div key={f.id} onClick={()=>f.isFolder?openFolder(f):window.open(f.webViewLink,'_blank')} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',borderBottom:'1px solid #e8f0f8',cursor:'pointer',borderRadius:6}} onMouseEnter={e=>e.currentTarget.style.background='#f0f4f9'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
        <span style={{fontSize:20}}>{icon(f.mimeType)}</span>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</div><div style={{fontSize:10,color:'#6b8299'}}>{f.modifiedTime&&new Date(f.modifiedTime).toLocaleDateString()}{f.size?' · '+fmt(f.size):''}{f.shared?' · Shared':''}</div></div>
      </div>)}
    </div>
  </div>);
}
