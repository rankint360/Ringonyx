# Ringonyx

Track, route, and monetize inbound leads.

## Run locally

Requires Node.js 24 or later. From this directory, provision a workspace owner in PowerShell 7. The password prompt is masked, and the password is sent to the CLI over standard input.

```powershell
Read-Host 'Ringonyx password (14 or more characters)' -MaskInput |
  node server.mjs --provision owner@example.com owner --new "My workspace"
npm start
```

Open http://127.0.0.1:3000/app and sign in. SQLite stores data in `data/ringonyx.sqlite`. Set `RINGONYX_DB` consistently for provisioning and serving if you use a custom database. Run `npm test` for the integration checks.

To add an operator or read-only viewer, run the provisioning command with their email and the `operator` or `viewer` role. Replace `--new "My workspace"` with `--account WORKSPACE_ID` using the ID printed at provisioning. Owners and operators can manage rental workflows. Viewers can read records in their workspace without access to renter portal links. Account provisioning runs through the CLI.

Existing databases keep their records in the `legacy` workspace. Use `--account legacy` when provisioning the owner for those records. For staging, set `NODE_ENV=production` and terminate HTTPS at a reverse proxy that preserves the public Host header. Production mode uses secure cookies and disables the optional local API key.

Add a tracking site and two renters. Assign the first renter with a charge in cents and minimum talk time. Simulate an arrival, reassign the site, then complete the call. Open each renter portal to inspect the allocation and charges. Simulate another call to confirm the new destination.

The console supports simulated calls and Twilio Voice forwarding for an existing number. To prepare a carrier test, configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `RINGONYX_VOICE_ORIGIN` as a bare public HTTPS origin. Add the existing number as a tracking site, assign a renter, and save its campaign source under **Connect a tracking number**. In Twilio, set the number’s incoming voice webhook to POST to `/webhooks/twilio/voice` on that origin. The application supplies its completion callback in the TwiML response.

Signed webhook tests cover the forwarding path locally. A real carrier call and invoice issuance remain pending. Renter portal links grant access to that renter’s call and charge history.

The product homepage is at `/` and the operator console is at `/app`. The homepage demo uses sample data and does not change the console database.

## Test visitor attribution locally

Add a tracking site, assign a renter, and add a pool number in the console. Copy the site ID from **Visitor number pools**. On a test page, use a fixed phone link and load the Ringonyx script after that link.

```html
<a data-ringonyx-number href="tel:+16025550100">+16025550100</a>
<script src="http://127.0.0.1:3000/tracking.js" data-site="SITE_ID"></script>
```

Open the test page with `?utm_source=search&utm_campaign=repair`, then simulate a call to the displayed pool number. The call log shows both attribution values. A browser tab keeps its assigned number for up to 30 minutes. When the pool is full or the lease expires, the page uses the fixed number. This test uses simulated calls. Connect real numbers and an HTTPS script origin before embedding on an HTTPS site.

## Buyer and publisher network


Sign in and open `/network`. Add a buyer contract and publisher offer, preview a bid, submit a simulated call with a unique reference, and settle the call. The ledger shows revenue, payout, and margin. Buyer and publisher links show each partner’s own amounts.

The local publisher endpoints are `POST /api/publisher/ping` and `POST /api/publisher/post`. Use the offer’s publisher API token as a Bearer credential. Send a two-letter `region` and optionally a bid `floor` in cents and a `strategy` of `price` or `predictive`. Include a stable `reference` for post. Ping is a preview. Post evaluates current capacity and reserves a slot if a buyer qualifies. The operator must settle simulated calls to release their slots. Buyer bids use contract prices, and caps reset by UTC day. Partner portal links use separate credentials.

Network calls are simulated. Live buyer bid requests, carrier routing for network calls, and payout transfers are deferred.

## Web lead intake and delivery

Open **Web leads** in the operator console. Each tracking site has hosted inquiry and chat message links. Add `utm_source` and `utm_campaign` to a link to capture campaign attribution. Chat intake accepts an asynchronous message and contact details. A matching email or phone number on the same site within 24 hours reuses the original lead.

Deliver a lead directly to a buyer or request a quote and accept it within five minutes. Local quotes use buyer contract prices. Delivery checks coverage, buyer pause state, and regional suppression. A lead can be delivered once, and a buyer can view their delivered leads in their portal. The operator report counts calls, form leads, and chat leads by source.

External chat providers and buyer delivery endpoints remain deferred.

## Analytics and conversation review

Open **Analytics** to compare calls, form leads, and chat leads by campaign, and to review renter invoice and network settlement totals. Select an answered call and paste its transcript. Use a `Caller:` prefix for caller lines so the preview can flag booking intent. Edit the excerpt and coaching note, choose a qualification outcome, and save the review. Verified bookings come from billing records.

Configure an answering profile for a site and enter a sample message to test the booking, escalation, or fallback response. The local preview uses keyword rules. Audio transcription, model-backed analysis, and live answering remain deferred.

## Local operations

Open **Operations** for CRM contacts and conversion CSV exports, service health, and recent successful changes. Workspace owners can import up to 100 tracking sites from a CSV with a `name,number` header, customize the name and accent on renter and partner portals, and issue or revoke read-only developer keys.

Send the developer key as a Bearer token to `/api/v1/sites` or `/api/v1/campaigns`, according to its scope. To use the local MCP bridge, run `node mcp.mjs` as a stdio server with `RINGONYX_DEVELOPER_TOKEN` and the loopback `RINGONYX_API_ORIGIN` in its environment. The bridge supports MCP protocol version `2025-11-25` and exposes only the token's read scope.

Owners can generate a signing key and sign an audit event or sample event. Verify the hex signature with HMAC-SHA256 over the timestamp, a period, and the exact JSON payload. Delivery to an external endpoint remains deferred.

Run `node server.mjs --backup path/to/new-backup.sqlite` from the server directory to take a consistent snapshot of the entire database. Use the same `RINGONYX_DB` value as the running server if configured. The snapshot includes every workspace and must be stored with the same access controls as the source database.

## Release and recovery

1. Run `npm test` on Node.js 24 or later. The suite exercises workspace access, call and lead processing, billing, analytics, operations, and recovery from a SQLite snapshot.
2. For staging, set `NODE_ENV=production`, `RINGONYX_DB` to an absolute path on persistent storage, and `PORT` to the loopback port the HTTPS reverse proxy forwards to. Create the database parent directory, provision a staging owner using the commands above, and start `npm start` under the host's service manager.
3. Confirm `GET /health` returns `{"status":"ok"}` through the proxy. Open the homepage and `/app`, sign in, and verify the session cookie is Secure. With test data, simulate a call, complete it, check its invoice totals, and submit a form lead through its public intake link. Confirm that the intended renter or buyer sees the relevant records in their portal.
4. Before an upgrade, save a snapshot to a fresh path. For a restore drill, copy the snapshot to a separate writable path, point a second server at the copy on another port, sign in, and verify site, call, and billing records. For rollback, stop the service and switch to the compatible source revision and verified snapshot before restarting. Keep the pre-rollback database for reconciliation of any writes made after the snapshot.
5. After staging passes, verify the configured live providers with test accounts and test traffic before opening public access. Record the deployed revision, smoke-test results, and launch decision in the Record Register.
