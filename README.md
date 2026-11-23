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

## Application services added on 2026-11-23

Open **Workspace tools** after signing in. Its tabs expose plan and wallet controls, invoice lifecycle, audio recordings, provider delivery, routing policies, and number management. Signup requests at `/register` enter the platform approval queue. Password recovery starts at `/reset`. Money values in the API are integer US cents.

Managed plans are opt-in for existing workspaces. Draft Individual and Network prices follow the supplied screenshots. A trial lasts 14 days and can be started once per workspace. Paid activation requires a trusted settlement event. The service tracks renewal requests and cancellation boundaries. Limits affect new resources and preserve existing records. A wallet top-up request has no value until settled. Reservations, captures, releases, usage events, and receipts use stable references to prevent duplicate accounting.

### Deferred provider contracts

The app sends normalized Ringonyx event envelopes to configured HTTPS endpoints. Native adapters for carrier, payments, email, CRM, ads, AI, and other provider APIs remain separate integration work. A generic endpoint connection does not establish native OAuth or provider-specific field mapping.

The durable outbox records attempts, applies exponential retry delays, and stops automatic retries after five failures. Owners can retry or cancel outstanding jobs. Workers send the job ID as an idempotency key, so the receiving adapter must deduplicate it. Dispatch stays disabled until `RINGONYX_DELIVERY_ENABLED=true`. The server allowlist `RINGONYX_DELIVERY_HOSTS` names exact endpoint hosts allowed for delivery. Credentials require `RINGONYX_VAULT_KEY`, a stable 64-character hexadecimal AES-256 key. Saved credentials are never returned. Preserve that key with encrypted database backups.

A trusted adapter reports completion to `POST /webhooks/ringonyx/events`. The payment alias is `/webhooks/ringonyx/payment`. Use HMAC-SHA256 with `RINGONYX_PAYMENT_EVENT_SECRET` over the Unix timestamp, a period, and the exact raw JSON. Send the timestamp as `X-Ringonyx-Timestamp` and the hex signature as `X-Ringonyx-Signature`. Events older than five minutes are rejected.

- Payment events contain `type: "payment"`, a unique receipt `id`, and the payment `request` ID.
- Carrier events contain `type: "carrier"`, a carrier `request` ID, and `state: "complete"` or `"failed"`. Inventory results supply up to 100 `offers` with `number`, `location`, `monthly`, and `activation`. Purchase results supply `providerReference`. Callback results supply `seconds` and `cents`, capped by reserved cost.
- Usage events contain `type: "usage"`, `account`, unique `reference`, `kind`, `units`, and `cents`. They can debit available wallet credit.

These contracts require a trusted adapter. Individual providers use their own webhook formats and authentication.

### Maintenance and media

Run `node server.mjs --maintenance` with the same database and secrets as the app. It checks subscription renewals, runs scheduled invoices, removes expired audio, and dispatches eligible jobs if enabled. Configure the schedule during deployment setup. Billing schedules use UTC. Monthly rent runs bill the previous calendar month. Manual runs gather currently unbilled charges, and references prevent duplicate billing.

Staff can upload audio up to 10 MB per recording. SQLite stores the audio. Scoped staff and renter endpoints provide playback. Retention supports 30, 90, 180, or 365 days and preserves deletion metadata. Carrier audio ingestion remains integration work.

Reviewed spam, solicitor, and wrong-number classifications create a credit or remove an unbilled charge only when an owner enables billing automation. Paid or void invoices need manual reconciliation. Model inference remains AI integration work.

The target editor supports dragging and keyboard buttons. Restoring a target or keypad-menu version creates another revision. Hours, ZIP coverage, round robin, weights, and ring-all groups execute in the simulator. Live carrier execution and browser WebRTC remain integration work.

Visual comparison, native provider acceptance, and public launch testing remain pending.

### Auctions and intelligence

Workspace tools includes buyer auctions and conversation/caller-data controls. An auction records a deadline from 200 to 10,000 ms and queues requests for matching regional buyers. A signed event with `type: "bid"`, `request` (auction ID), `buyer`, and `cents` records one response per buyer. Late responses remain visible and cannot win. Awarding rechecks current eligibility and reserves capacity and budgets using the winning bid. Settlement uses that saved bid.

The trusted adapter event `type: "intelligence"` uses a request ID and a terminal `state` of `complete` or `failed`. Result fields depend on the original request.

- Transcription returns `transcript`, up to 6,000 characters.
- Analysis returns `summary`, `intent`, score from 0 to 100, sentiment (`positive`, `neutral`, `negative`, or `unknown`), urgency (`low`, `normal`, or `high`), and optional `coaching`. An optional classification can be `qualified`, `spam`, `wrong-number`, or `solicitor`. Billing adjustments still require the owner's automation setting.
- Booking verification returns a boolean `confirmed` and, when confirmed, `evidence`. The charge and booking reference come from the original application request.
- Caller data can include `name`, `lineType`, `carrier`, `city`, `region`, `country`, `source`, and a textual `profile`.

Request IDs bind results to the original workspace and call. Replaying a completed result does not duplicate a charge or booking. Results appear in Workspace tools and preserve separate human-review records.

An optional long-running processor is available as `node server.mjs --worker`. It needs access to the same persistent database and environment as the web server. It expires auctions, runs maintenance, and dispatches allowed jobs. Native low-latency buyer adapters are still required for real-time bidding. Configure process supervision and scheduling during the integration/deployment stage.
