# CareCoord — Regional Care Coordination Messaging Overlay

A full-stack HIPAA-oriented communications overlay for regional care coordinators. Inbound emails land in shared regional queues; coordinators claim and work tickets entirely within this application.

## Architecture

```
carecoord/
├── server/            # Express + SQLite backend
│   ├── index.js       # Main server (port 3001)
│   ├── database.js    # SQLite schema + connection
│   ├── seed.js        # Demo data seeder
│   ├── middleware.js   # Auth + audit helpers
│   └── routes/
│       ├── auth.js    # Login/logout/session
│       ├── tickets.js # CRUD, assign, reply, notes, tags
│       ├── dashboard.js # Supervisor metrics
│       ├── ref.js     # Regions, users, tags, close reasons
│       └── audit.js   # Audit log viewer
├── client/            # React + Vite frontend
│   └── src/
│       ├── App.jsx    # Shell with routing + sidebar
│       ├── api.js     # API client module
│       └── components/
│           ├── LoginScreen.jsx
│           ├── QueueScreen.jsx
│           ├── TicketDetail.jsx
│           ├── Dashboard.jsx
│           └── AuditLog.jsx
└── package.json       # Root scripts (concurrently)
```

## Quick Start

### Prerequisites
- **Node.js 18+** (for `--watch` flag; 16+ works without auto-reload)
- **npm 8+**

### Setup (one time)

```bash
# 1. Install root dependencies (concurrently)
npm install

# 2. Install server + client dependencies
npm run install:all

# 3. Seed the database with demo data
npm run seed
```

### Run

```bash
# Start both server (port 3001) and client (port 5173)
npm run dev
```

Then open **http://localhost:5173** in your browser.

### Individual commands

```bash
npm run dev:server   # Server only (port 3001)
npm run dev:client   # Client only (port 5173, proxies /api → 3001)
npm run build        # Production build of client
npm run start        # Production server (serves built client)
```

## Demo Users

| Name | Role | Regions |
|------|------|---------|
| Sarah Mitchell | Coordinator | Central PA, Triage |
| James Rivera | Coordinator | Central PA |
| Angela Chen | Coordinator | Western PA |
| Marcus Brown | Coordinator | Western PA, Triage |
| Lisa Nowak | Coordinator | Eastern PA |
| **Dr. Patricia Hayes** | **Supervisor** | **All regions** |
| Tom Adkins | Admin | All regions |

**Tip:** Sign in as Dr. Patricia Hayes to see the supervisor dashboard, bulk reassignment, and audit log.

## Features Implemented

### Core Workflow
- ✅ Inbound email intake → ticket creation with threading
- ✅ Automatic region routing (sender mapping + triage queue)
- ✅ Region Queue → Personal Queue assignment ("Assign to Me")
- ✅ Outbound replies from within ticket UI (Option A: region address + attribution)
- ✅ Inbound reply appends to existing thread
- ✅ Close with required reason (dropdown + conditional comment)
- ✅ Unassign / return to region queue

### Queue Views
- ✅ Region Queue with filters: Active, Unassigned, Open, Waiting, Closed
- ✅ Personal Queue (assigned to current user)
- ✅ Multi-region filter (for users in multiple regions)
- ✅ Search across subject, sender, ticket ID
- ✅ Unread indicators
- ✅ Auto-refresh polling (10s queue, 15s counts)

### Ticket Detail
- ✅ Threaded timeline: inbound (left), outbound (right), notes (center)
- ✅ Reply composer with signature attribution
- ✅ Internal notes (team-only, yellow-themed)
- ✅ Tag management (add/remove)
- ✅ Status transitions (Open ↔ Waiting ↔ Closed)
- ✅ Region transfer (supervisor only)
- ✅ Assignment panel with coordinator dropdown

### Supervisor
- ✅ Dashboard: open/unassigned/closed-today/triage counts
- ✅ By-region breakdown with unassigned counts
- ✅ By-coordinator workload
- ✅ Oldest open ticket alert
- ✅ Drill-down: click region or coordinator → ticket list
- ✅ Bulk reassign: move all tickets from one coordinator to another (or to queue)
- ✅ Reopen closed tickets (supervisor-only override)

### Audit & Security
- ✅ Immutable audit log for all state changes
- ✅ Audit log viewer with action type filter
- ✅ No delete capability (soft-delete only by design)
- ✅ Session-based auth with httpOnly cookies
- ✅ Role-based access control (coordinator vs supervisor vs admin)

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login (body: `{ userId }`) |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user |

### Tickets
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tickets` | List tickets (query: queue, region, status, search) |
| GET | `/api/tickets/:id` | Get ticket detail |
| GET | `/api/tickets/:id/messages` | Get threaded messages |
| GET | `/api/tickets/:id/notes` | Get internal notes |
| POST | `/api/tickets/:id/assign` | Assign (body: `{ userId }`) |
| POST | `/api/tickets/:id/status` | Change status |
| POST | `/api/tickets/:id/reply` | Send outbound reply |
| POST | `/api/tickets/:id/notes` | Add internal note |
| POST | `/api/tickets/:id/tags` | Add tag |
| DELETE | `/api/tickets/:id/tags/:tagId` | Remove tag |
| POST | `/api/tickets/:id/region` | Transfer region |
| POST | `/api/tickets/bulk/reassign` | Bulk reassign (supervisor) |

### Dashboard & Audit
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard/summary` | Supervisor summary |
| GET | `/api/dashboard/by-region` | Region breakdown |
| GET | `/api/dashboard/by-coordinator` | Coordinator workload |
| GET | `/api/audit` | Audit log (query: filter, limit) |

### Reference Data
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ref/regions` | All regions |
| GET | `/api/ref/users` | All users |
| GET | `/api/ref/tags` | All tags |
| GET | `/api/ref/close-reasons` | Close reason options |

## Production Considerations

This is a demo/development build. For production deployment:

1. **Auth**: Replace demo login with Google SSO / SAML via passport.js
2. **Database**: Migrate from SQLite to PostgreSQL (RDS/Cloud SQL) with encryption at rest
3. **Email Integration**: Add Gmail API watch or SMTP inbound gateway (Section 9 of spec)
4. **SMTP Outbound**: Configure via Workspace relay or SendGrid with DKIM/SPF
5. **Sessions**: Switch to Redis-backed sessions
6. **HTTPS**: Required for HIPAA; use reverse proxy (nginx) or cloud LB
7. **Secrets**: Move session secret to environment variable / secrets manager
8. **MFA**: Enforce via SSO provider
9. **Logging**: Structured logging (pino/winston); avoid logging PHI
10. **File Storage**: Attachments → S3/GCS with signed URLs
