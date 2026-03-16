// fix-infinite-loop.js
const fs = require('fs');
const path = require('path');

// Fix GmailConnectButton - stop polling after connected
const panelPath = path.join(__dirname, 'client', 'src', 'components', 'GmailPanel.jsx');
let panel = fs.readFileSync(panelPath, 'utf8');

// The issue is the connect polling never stops properly and status checks cause re-renders
// Replace the entire GmailConnectButton with a stable version
panel = panel.replace(
  /export function GmailConnectButton[\s\S]*?^}/m,
  `export function GmailConnectButton({ showToast }) {
  const [status, setStatus] = useState({ connected: false, email: null });
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    let mounted = true;
    api.gmailStatus().then(s => { if (mounted) { setStatus(s); setLoading(false); } }).catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const connect = async () => {
    try {
      const data = await api.gmailAuth();
      window.open(data.authUrl, '_blank', 'width=500,height=600');
      setPolling(true);
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (attempts > 60) { clearInterval(poll); setPolling(false); return; }
        try {
          const s = await api.gmailStatus();
          if (s.connected) {
            clearInterval(poll);
            setPolling(false);
            setStatus(s);
            if (showToast) showToast('Google Workspace connected!');
          }
        } catch (e) {}
      }, 2000);
    } catch (e) { if (showToast) showToast(e.message); }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect Google Workspace?')) return;
    await api.gmailDisconnect();
    setStatus({ connected: false, email: null });
    if (showToast) showToast('Google Workspace disconnected');
  };

  if (loading) return null;

  if (status.connected) {
    return (
      <div style={{ padding: '8px 12px', background: '#102f54', borderRadius: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: '#a8c8e8', marginBottom: 2 }}>Google Workspace</div>
        <div style={{ fontSize: 11, color: '#ffffff', fontWeight: 500, marginBottom: 4 }}>{status.email}</div>
        <button onClick={disconnect} style={{ fontSize: 10, color: '#a8c8e8', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button onClick={connect} disabled={polling} style={{
      width: '100%', padding: '8px 12px', background: '#1a5e9a', color: '#fff', border: 'none',
      borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, marginBottom: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>
      {polling ? 'Connecting...' : 'Connect Google Workspace'}
    </button>
  );
}`
);

fs.writeFileSync(panelPath, panel, 'utf8');
console.log('  ✓ GmailPanel.jsx — fixed polling loop');

// Fix CalendarPanel — stabilize useEffect
const calPath = path.join(__dirname, 'client', 'src', 'components', 'CalendarPanel.jsx');
let cal = fs.readFileSync(calPath, 'utf8');

// The issue: useEffect depends on weekOffset but fetchEvents isn't memoized properly
cal = cal.replace(
  /useEffect\(\(\) => \{\s*api\.gmailStatus\(\)\.then[\s\S]*?\}, \[weekOffset\]\);/,
  `useEffect(() => {
    let mounted = true;
    api.gmailStatus().then(s => {
      if (!mounted) return;
      setConnected(s.connected);
      if (s.connected) {
        const start = new Date();
        start.setDate(start.getDate() + weekOffset * 7);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        setLoading(true);
        api.calendarEvents(start.toISOString(), end.toISOString())
          .then(data => { if (mounted) setEvents(data.events || []); })
          .catch(e => { if (mounted && showToast) showToast(e.message); })
          .finally(() => { if (mounted) setLoading(false); });
      } else {
        setLoading(false);
      }
    }).catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [weekOffset]);`
);

fs.writeFileSync(calPath, cal, 'utf8');
console.log('  ✓ CalendarPanel.jsx — stabilized useEffect');

// Fix DrivePanel — same issue
const drivePath = path.join(__dirname, 'client', 'src', 'components', 'DrivePanel.jsx');
let drive = fs.readFileSync(drivePath, 'utf8');

drive = drive.replace(
  /useEffect\(\(\) => \{\s*api\.gmailStatus\(\)\.then[\s\S]*?\}, \[\]\);/,
  `useEffect(() => {
    let mounted = true;
    api.gmailStatus().then(s => {
      if (!mounted) return;
      setConnected(s.connected);
      if (s.connected) {
        setLoading(true);
        api.driveFiles('', null)
          .then(data => { if (mounted) setFiles(data.files || []); })
          .catch(e => { if (mounted && showToast) showToast(e.message); })
          .finally(() => { if (mounted) setLoading(false); });
      } else {
        setLoading(false);
      }
    }).catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);`
);

fs.writeFileSync(drivePath, drive, 'utf8');
console.log('  ✓ DrivePanel.jsx — stabilized useEffect');

console.log('\n✅ Fixed infinite loop. Refresh browser.');
