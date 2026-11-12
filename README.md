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

## Buyer and publisher network

Sign in and open `/network`. Add a buyer contract and publisher offer, preview a bid, submit a simulated call with a unique reference, and settle the call. The ledger shows revenue, payout, and margin. Buyer and publisher links show each partner’s own amounts.

The local publisher endpoints are `POST /api/publisher/ping` and `POST /api/publisher/post`. Use the offer’s publisher API token as a Bearer credential. Send a two-letter `region` and optionally a bid `floor` in cents and a `strategy` of `price` or `predictive`. Include a stable `reference` for post. Ping is a preview. Post evaluates current capacity and reserves a slot if a buyer qualifies. The operator must settle simulated calls to release their slots. Buyer bids use contract prices, and caps reset by UTC day. Partner portal links use separate credentials.

Network calls are simulated. Live buyer bid requests, carrier routing for network calls, and payout transfers are deferred.
