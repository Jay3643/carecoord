# Reply All + thread-matching verification

**Context:** Two separate bugs were fixed in sequence. This guide covers both.

- **`df5bd3d`** — inbound mail synced before this commit stored only the syncing user's own address in the To list and dropped Cc entirely. Reply All silently omitted recipients.
- **`b798e37`** — Message-ID lookups compared bracket-stripped query values against bracketed stored values, so In-Reply-To and References matching never worked. Outbound sends also stored a placeholder Message-ID instead of the real one. Together this caused replies to create *new unlinked tickets* whenever the receiving user wasn't on the original or `gmail_thread_id` didn't match.

The first three sections verify recipient capture (`df5bd3d`). The fourth section verifies threading (`b798e37`).

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

## Verifying thread-matching (replies stay in the same ticket)

These tests confirm that an external party's reply lands on the existing ticket instead of spawning a new one. The first test exercises the within-mailbox path (works via `gmail_thread_id`); the second exercises the cross-mailbox path that depended on the broken Message-ID match.

### Test A: Reply from external party threads onto the original ticket

1. From an external account, send an email addressed only to **one** CareCoord user.
2. Wait for the ticket to appear.
3. From the CareCoord ticket, click **Reply** and send a response.
4. From the external account, hit **Reply** to that response (so the new email's `In-Reply-To` references CareCoord's outbound Message-ID).
5. Wait ~30 seconds for sync.
6. Open the original ticket. The external party's latest reply should appear as a new inbound message in the **same** ticket timeline. The ticket count in the queue should **not** have incremented; no new ticket ID should exist for this thread.

### Test B: New participant Cc'd onto a reply — should link, not float

This is the case that was completely broken before `b798e37`.

1. From an external account, send an email to **CareCoord user A** with one external party in To.
2. Wait for ticket A to appear.
3. From the external account, **reply-all** but also Cc **CareCoord user B** (who was not on the original).
4. Wait ~30 seconds.
5. Verify:
   - User A's ticket shows the reply appended to its timeline (no new ticket for user A).
   - User B has a **new ticket** for the reply (expected — they weren't on the original), but it should be **linked** to user A's ticket: the `Sent to N recipients ▾` pill on user B's ticket should expand and list user A as a linked recipient, and clicking through the linked-ticket chip should navigate to ticket A.
   - User A's ticket should likewise show user B as a linked recipient.

If user B's ticket appears with no linked-recipients pill, or if the reply spawns a fresh unlinked ticket for user A, treat as a regression.

### Test C: Reply-all from CareCoord threads on recipients' clients

1. Open any multi-recipient ticket.
2. Click **Reply All** and send.
3. Open the resulting message in any recipient's inbox (Gmail/Outlook/etc.).
4. The message should be **threaded** under the original — i.e., appear nested inside the existing conversation, not as a standalone email with the same subject. This confirms the `In-Reply-To` and `References` headers are being set on outbound.

## Historical tickets

Pre-fix data behaves differently across the two bugs:

**Recipient data (`df5bd3d`)** — inbound rows from before this commit still have the synthetic single-recipient `to_addresses` and `NULL` `cc_addresses`. Reply All on those tickets will continue to drop recipients. Symptoms:

- The header pill reads `Sent to 1 recipient` even though the original was multi-recipient.
- Reply All's Cc field is empty or missing addresses you remember being on the thread.

Remediate by running the backfill endpoint (next section).

**Threading data (`b798e37`)** — the bracket-tolerant Message-ID match is **retroactive**: it applies to every existing inbound row the moment the fix deploys, no backfill needed. However, outbound rows sent before this commit carry the placeholder `provider_message_id` (`msg-int-<ts>` / `msg-fwd-<ts>`). In practice this rarely matters — external replies to those still thread via `gmail_thread_id` within the original sender's mailbox — but if a new participant gets Cc'd onto a reply to a pre-fix CareCoord message, it may still spawn an unlinked ticket. Either reopen and resend from CareCoord (which writes a fresh outbound with a real Message-ID), or accept the gap for that historical thread.

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
