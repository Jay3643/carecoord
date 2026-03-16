const fs = require('fs');
let f = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// 1. Fix fetchTickets to pass queue mode and always fetch ALL statuses
f = f.replace(
  `const fetchTickets = async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedRegion) params.regionId = selectedRegion;
      if (queueFilter && queueFilter !== 'all') params.status = queueFilter;
      if (searchQuery) params.q = searchQuery;
      const data = await api.getTickets(params);
      setTickets(data.tickets || data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };`,
  `const fetchTickets = async () => {
    setLoading(true);
    try {
      const params = { queue: mode === 'personal' ? 'personal' : 'region', status: 'all' };
      if (selectedRegion && selectedRegion !== 'all') params.region = selectedRegion;
      if (searchQuery) params.search = searchQuery;
      const data = await api.getTickets(params);
      setTickets(data.tickets || data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };`
);

// 2. Re-fetch when region or search changes
f = f.replace(
  "useEffect(() => { fetchTickets(); }, []);",
  "useEffect(() => { fetchTickets(); }, [selectedRegion, searchQuery]);"
);

// 3. Add client-side filtered list based on queueFilter
// Find the filterCounts useMemo and add a filteredTickets after it
f = f.replace(
  "  return (\n    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>",
  `  const filteredTickets = useMemo(() => {
    if (queueFilter === 'all') return tickets.filter(t => t.status !== 'CLOSED');
    if (queueFilter === 'unassigned') return tickets.filter(t => !t.assignee_user_id && t.status !== 'CLOSED');
    if (queueFilter === 'open') return tickets.filter(t => t.status === 'OPEN');
    if (queueFilter === 'waiting') return tickets.filter(t => t.status === 'WAITING_ON_EXTERNAL');
    if (queueFilter === 'closed') return tickets.filter(t => t.status === 'CLOSED');
    return tickets;
  }, [tickets, queueFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>`
);

// 4. Replace tickets.map with filteredTickets.map in the render
f = f.replace(
  "!loading && tickets.length === 0 && (",
  "!loading && filteredTickets.length === 0 && ("
);
f = f.replace(
  "{tickets.map(ticket => {",
  "{filteredTickets.map(ticket => {"
);

fs.writeFileSync('client/src/components/QueueScreen.jsx', f, 'utf8');
// 5. Fix server tickets.js to handle status=all
let tk = fs.readFileSync('server/routes/tickets.js', 'utf8');
if (!tk.includes("status === 'all'")) {
  tk = tk.replace(
    "else where.push(\"t.status != 'CLOSED'\");",
    "else if (status !== 'all') where.push(\"t.status != 'CLOSED'\");"
  );
  fs.writeFileSync('server/routes/tickets.js', tk, 'utf8');
  console.log('  ✓ tickets.js — status=all returns everything');
}

console.log('fixed — filters work client-side, queue mode sent to server');
