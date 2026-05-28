# Reply All recipient verification

**Context:** Inbound emails synced before commit `df5bd3d` stored only the syncing user's own address as the To list and dropped the Cc list entirely. Reply All on those tickets silently omits recipients. The bug was fixed for all mail synced going forward; this guide walks through verifying the fix and confirms which historical tickets are affected.

## Verifying the fix on fresh mail

From an email account **outside** CareCoord (personal Gmail, Outlook, etc.):

1. Compose a new email. In the To/Cc fields include:
   - One CareCoord-monitored address (a region alias or a connected user's mailbox)
   - At least two other recipients — mix of in-system CareCoord users and external addresses
   - Example To: `intake@region1.com, jen@seniorityhealthcare.com, scheduler@external-clinic.com`
   - Example Cc: `billing@external-clinic.com, drhopkins@seniorityhealthcare.com`
2. Send.
3. Wait ~30 seconds for CareCoord's sync to pull it in (or trigger a manual refresh from the queue).
4. Open the new ticket and check three things:
   - **Header pill** reads `Sent to N recipients ▾` where N matches what you sent.
   - **Click the pill** — it expands and shows the full `To:` and `Cc:` lists with every original address.
   - **Inbound message body** in the timeline shows the same To and Cc lines under the sender.
5. Click **Reply All**. The Cc field should be pre-populated with every recipient from the original email *except* your own address and the sender's. No address should be missing.
6. Send the reply. Open it in each recipient's inbox and confirm delivery.

If any of those checks fail on a freshly-synced email, treat it as a regression and report.

## Historical tickets

Tickets whose inbound mail was synced **before** the fix still have the broken data. Reply All on those will continue to drop recipients. You can identify these in two ways:

- The header pill reads `Sent to 1 recipient` even though the original was multi-recipient.
- Reply All's Cc field is empty or missing addresses you remember being on the thread.

To remediate historical data, an admin runs the backfill endpoint (see below). It re-fetches each affected message's headers from Gmail and rewrites the recipient columns. Until you run that, just send fresh test mail to verify the fix.

## Backfill (admin only)

The endpoint refetches `To` and `Cc` headers from Gmail for every inbound message that's missing recipient data and rewrites the `to_addresses` and `cc_addresses` columns. Identifier: `cc_addresses IS NULL` (post-fix rows always store `[]` for empty Cc, so NULL marks pre-fix rows).

Run from any admin's authenticated browser session, or via curl with the session cookie:

```bash
# Dry run first — scans without writing, returns counts
curl -X POST https://carecoord-o3en.onrender.com/api/gmail/backfill-recipients \
  -H 'Content-Type: application/json' \
  -b 'sid=<your-admin-session-cookie>' \
  -d '{"limit":100,"dryRun":true}'

# Live run, 200 rows per call
curl -X POST https://carecoord-o3en.onrender.com/api/gmail/backfill-recipients \
  -H 'Content-Type: application/json' \
  -b 'sid=<your-admin-session-cookie>' \
  -d '{"limit":200}'
```

Response shape:

```json
{
  "scanned": 200,
  "updated": 197,
  "failed": 2,
  "skipped": 1,
  "remaining": 843,
  "dryRun": false,
  "errors": [{ "id": "msg-...", "error": "Requested entity was not found." }]
}
```

- `scanned` — rows fetched this batch
- `updated` — rows successfully refetched and rewritten
- `failed` — Gmail API errors (e.g. message deleted, account disconnected); first 10 detailed in `errors`
- `skipped` — message's original syncing user has no available auth
- `remaining` — total still needing backfill after this batch

Call it repeatedly until `remaining === 0`. Each call is capped at `limit` (max 500) so a single batch won't hammer Gmail's API quota. Failures are non-fatal; rerun if you reconnect a disconnected user.

The endpoint is **idempotent** — once a row's `cc_addresses` is populated (even with `[]`), it's no longer in the candidate set, so re-running won't re-fetch already-backfilled rows.
