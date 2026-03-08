import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

export default function CalendarPanel({ showToast }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ summary:'', description:'', date:'', startTime:'09:00', endTime:'10:00', attendees:'', addMeet:false });
  const initRef = useRef(false);

  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      api.gmailStatus().then(s => { setConnected(s.connected); if (s.connected) loadEvents(0); else setLoading(false); }).catch(() => setLoading(false));
    } else if (connected) {
      loadEvents(weekOffset);
    }
  }, [weekOffset]);

  const loadEvents = (wo) => {
    setLoading(true);
    const s = new Date(); s.setDate(s.getDate() + wo * 7); s.setHours(0,0,0,0);
    const e = new Date(s); e.setDate(e.getDate() + 7);
    api.calendarEvents(s.toISOString(), e.toISOString())
      .then(d => setEvents(d.events || []))
      .catch(e => showToast && showToast(e.message))
      .finally(() => setLoading(false));
  };

  const create = async () => {
    if (!form.summary || !form.date) return;
    try {
      const att = form.attendees ? form.attendees.split(',').map(e=>e.trim()).filter(Boolean) : [];
      const r = await api.calendarCreate({ summary:form.summary, description:form.description, startTime:form.date+'T'+form.startTime+':00', endTime:form.date+'T'+form.endTime+':00', attendees:att, addMeet:form.addMeet });
      showToast && showToast('Event created!' + (r.meetLink ? ' Meet link added.' : ''));
      setShowCreate(false); setForm({ summary:'', description:'', date:'', startTime:'09:00', endTime:'10:00', attendees:'', addMeet:false });
      loadEvents(weekOffset);
    } catch(e) { showToast && showToast(e.message); }
  };

  const del = async (id) => { if (!confirm('Delete event?')) return; await api.calendarDelete(id); loadEvents(weekOffset); };

  const inp = { width:'100%', padding:'8px', background:'#f0f4f9', border:'1px solid #c0d0e4', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box' };
  const btn = (bg,fg) => ({ padding:'8px 16px', background:bg, color:fg, border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600 });
  const ws = new Date(); ws.setDate(ws.getDate() + weekOffset * 7);
  const wl = ws.toLocaleDateString([],{month:'short',day:'numeric'}) + ' — ' + new Date(ws.getTime()+6*86400000).toLocaleDateString([],{month:'short',day:'numeric'});

  if (!connected) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:12}}><h2 style={{fontSize:18,fontWeight:700}}>Calendar</h2><p style={{fontSize:13,color:'#6b8299'}}>Connect Google Workspace to view calendar.</p></div>;

  return (<div style={{display:'flex',flexDirection:'column',height:'100%'}}>
    <div style={{padding:'12px 24px',borderBottom:'1px solid #c0d0e4',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <button onClick={()=>setWeekOffset(w=>w-1)} style={btn('#dde8f2','#1e3a4f')}>◀</button>
        <h2 style={{fontSize:16,fontWeight:700,margin:0}}>{wl}</h2>
        <button onClick={()=>setWeekOffset(w=>w+1)} style={btn('#dde8f2','#1e3a4f')}>▶</button>
        {weekOffset!==0 && <button onClick={()=>setWeekOffset(0)} style={btn('#f0f4f9','#6b8299')}>Today</button>}
      </div>
      <button onClick={()=>setShowCreate(true)} style={btn('#1a5e9a','#fff')}>+ New Event</button>
    </div>
    <div style={{flex:1,overflow:'auto',padding:20}}>
      {loading && <div style={{color:'#6b8299',textAlign:'center',padding:20}}>Loading...</div>}
      {!loading && events.length===0 && <div style={{color:'#6b8299',textAlign:'center',padding:40}}>No events this week</div>}
      {events.map(e => <div key={e.id} style={{padding:14,background:'#f0f4f9',border:'1px solid #c0d0e4',borderRadius:10,marginBottom:8,borderLeft:'4px solid #1a5e9a'}}>
        <div style={{display:'flex',justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:14,fontWeight:600}}>{e.summary}</div>
            <div style={{fontSize:11,color:'#6b8299',marginTop:2}}>{e.allDay ? new Date(e.start).toLocaleDateString() : new Date(e.start).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' — '+new Date(e.end).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</div>
            {e.location && <div style={{fontSize:11,color:'#6b8299',marginTop:2}}>📍 {e.location}</div>}
            {e.meetLink && <a href={e.meetLink} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#1a5e9a',fontWeight:600,textDecoration:'none',display:'inline-block',marginTop:4}}>🎥 Join Meet</a>}
          </div>
          <button onClick={()=>del(e.id)} style={{background:'none',border:'none',color:'#c0d0e4',cursor:'pointer',fontSize:14}}>✕</button>
        </div>
      </div>)}
    </div>
    {showCreate && <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}} onClick={()=>setShowCreate(false)}>
      <div style={{background:'#fff',borderRadius:16,padding:24,width:440}} onClick={e=>e.stopPropagation()}>
        <h3 style={{fontSize:16,fontWeight:700,margin:'0 0 16px'}}>New Event</h3>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <input value={form.summary} onChange={e=>setForm({...form,summary:e.target.value})} style={inp} placeholder="Title *" />
          <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} style={inp} />
          <div style={{display:'flex',gap:8}}><input type="time" value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})} style={{...inp,flex:1}} /><input type="time" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})} style={{...inp,flex:1}} /></div>
          <textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={2} style={{...inp,resize:'vertical'}} placeholder="Description" />
          <input value={form.attendees} onChange={e=>setForm({...form,attendees:e.target.value})} style={inp} placeholder="Attendees (comma-separated emails)" />
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,cursor:'pointer'}}><input type="checkbox" checked={form.addMeet} onChange={e=>setForm({...form,addMeet:e.target.checked})} />Add Google Meet</label>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
          <button onClick={()=>setShowCreate(false)} style={btn('#f0f4f9','#6b8299')}>Cancel</button>
          <button onClick={create} style={btn('#1a5e9a','#fff')}>Create</button>
        </div>
      </div>
    </div>}
  </div>);
}
