const fs = require('fs');
let f = fs.readFileSync('client/src/components/PersonalInbox.jsx', 'utf8');

// Replace the FOLDERS array with full Gmail sidebar
f = f.replace(
  `const FOLDERS = [
  { key:'INBOX', label:'Inbox', icon:'inbox' },
  { key:'STARRED', label:'Starred', icon:'star' },
  { key:'SENT', label:'Sent', icon:'send' },
  { key:'DRAFT', label:'Drafts', icon:'file' },
  { key:'ALL', label:'All Mail', icon:'mail' },
];`,
  `const FOLDERS = [
  { key:'INBOX', label:'Inbox', icon:'inbox' },
  { key:'STARRED', label:'Starred', icon:'star' },
  { key:'IMPORTANT', label:'Important', icon:'alertCircle' },
  { key:'SENT', label:'Sent', icon:'send' },
  { key:'DRAFT', label:'Drafts', icon:'file' },
  { key:'SCHEDULED', label:'Scheduled', icon:'clock' },
  { key:'ALL', label:'All Mail', icon:'mail' },
  { key:'SPAM', label:'Spam', icon:'x' },
  { key:'TRASH', label:'Trash', icon:'trash' },
];
const CATEGORIES = [
  { key:'CATEGORY_SOCIAL', label:'Social', icon:'users' },
  { key:'CATEGORY_UPDATES', label:'Updates', icon:'barChart' },
  { key:'CATEGORY_FORUMS', label:'Forums', icon:'log' },
  { key:'CATEGORY_PROMOTIONS', label:'Promotions', icon:'tag' },
];`
);

// Replace the sidebar to remove Compose and add categories section
f = f.replace(
  `<div style={{width:170,background:'#f0f4f9',borderRight:'1px solid #c0d0e4',flexShrink:0,display:'flex',flexDirection:'column'}}>
      <div style={{padding:10}}><button onClick={()=>setShowCompose(true)} style={{...btn('#1a5e9a','#fff'),width:'100%'}}>Compose</button></div>
      {FOLDERS.map(f => <button key={f.key} onClick={()=>switchFolder(f)} style={{width:'100%',display:'flex',alignItems:'center',gap:8,padding:'8px 14px',background:folder===f.key?'#dde8f2':'transparent',border:'none',cursor:'pointer',color:folder===f.key?'#1a5e9a':'#1e3a4f',fontSize:12,fontWeight:folder===f.key?600:400,textAlign:'left'}}><Icon name={f.icon} size={14}/> {f.label}</button>)}
      <div style={{flex:1}} />
      <div style={{padding:10,borderTop:'1px solid #c0d0e4',fontSize:10,color:'#6b8299'}}>Full Gmail inbox. Care emails also appear in Regional Queue.</div>
    </div>`,
  `<div style={{width:200,background:'#f0f4f9',borderRight:'1px solid #c0d0e4',flexShrink:0,display:'flex',flexDirection:'column',overflow:'auto'}}>
      <div style={{padding:'12px 8px 4px'}}>
        {FOLDERS.map(f => <button key={f.key} onClick={()=>switchFolder(f)} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'7px 14px',background:folder===f.key?'#dde8f2':'transparent',border:'none',cursor:'pointer',color:folder===f.key?'#1a5e9a':'#1e3a4f',fontSize:13,fontWeight:folder===f.key?600:400,textAlign:'left',borderRadius:folder===f.key?'0 16px 16px 0':0}}><Icon name={f.icon} size={16}/> {f.label}</button>)}
      </div>
      <div style={{padding:'8px 14px',fontSize:11,fontWeight:600,color:'#6b8299',textTransform:'uppercase',letterSpacing:0.5,marginTop:8}}>Categories</div>
      <div style={{padding:'0 8px 4px'}}>
        {CATEGORIES.map(f => <button key={f.key} onClick={()=>switchFolder(f)} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'7px 14px',background:folder===f.key?'#dde8f2':'transparent',border:'none',cursor:'pointer',color:folder===f.key?'#1a5e9a':'#5a7a8a',fontSize:13,fontWeight:folder===f.key?600:400,textAlign:'left',borderRadius:folder===f.key?'0 16px 16px 0':0}}><Icon name={f.icon} size={16}/> {f.label}</button>)}
      </div>
      <div style={{flex:1}} />
      <div style={{padding:10,borderTop:'1px solid #c0d0e4',fontSize:10,color:'#1a5e9a',background:'#e8f0f8',margin:8,borderRadius:6,lineHeight:1.4}}>
        ✉️ New incoming emails auto-route to Regional Queue as tickets.
      </div>
    </div>`
);

// Remove the compose modal trigger from sidebar (compose is via "New Message" in main sidebar)
// Keep the compose modal code in case it's still needed from search bar or elsewhere

fs.writeFileSync('client/src/components/PersonalInbox.jsx', f, 'utf8');
console.log('✓ PersonalInbox sidebar updated to match Gmail layout');
console.log('  - Inbox, Starred, Important, Sent, Drafts, Scheduled, All Mail, Spam, Trash');
console.log('  - Categories: Social, Updates, Forums, Promotions');
console.log('  - Compose button removed (use main sidebar "New Message" instead)');
console.log('Refresh browser.');
