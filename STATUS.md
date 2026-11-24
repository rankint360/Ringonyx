# Ringonyx build status

2026-11-24 Telnyx adoption starts with a native US/Canada number inventory adapter under the existing carrier connection. It validates USD quotes using integer decimal conversion, filters approximate results and reuses the scoped search/result workflow. Purchase and live Telnyx voice execution remain pending. TELNYX.md records this boundary. No Telnyx key configured or live request sent.

2026-11-24 adds supervised startup through npm start. The optional RINGONYX_DELIVERY_WORKER_ENABLED=true starts a delivery-only worker alongside the web server with the same database and environment. Child exits stop the paired processes so Render can restart the service. The delivery-only worker does not run invoice scheduling, renewal or recording retention. Global dispatch remains independently controlled by RINGONYX_DELIVERY_ENABLED. Parser checks only; hosted operation awaits configuration.

2026-11-24 adds native Resend email delivery through the existing email provider. The service credential selects Resend or SendGrid while existing connections retain SendGrid behavior. See RESEND.md for the private credential shape and deferred setup. No messages sent or provider configuration performed.

2026-11-23 provider execution build adds native SendGrid email, Slack alerts, HubSpot lead upserts, JSON/form lead delivery, Twilio inventory and caller lookup, OpenAI transcription/analysis, and JSON/form buyer bids. Native result application is account scoped. Delivery batches run concurrently with lease fencing and bid timeouts. Visitor marketing context now includes page paths, UTMs and ad-click identifiers. Existing connections keep gateway mode. Configuration, regression execution and live verification are deferred. Remaining application work is explicitly listed in [BUILD_BACKLOG.md](BUILD_BACKLOG.md). All pending features are not yet complete.

Application follow-up on 2026-11-23 adds Workspace tools for subscription trials and plan requests, wallet accounting and usage, carrier operation requests, durable delivery and encrypted credentials, invoice schedules and lifecycle, payout preparation, audio upload/playback/retention, reviewed charge adjustments, and routing policies with target editing and version restore. Public registration enters a platform approval queue. Password recovery queues a single-use reset email. Reports support custom dates, saved views, and column selection.

The same build adds timed buyer auctions with rechecked eligibility and winning-bid settlement, plus request/result processing for transcription, model analysis, caller data, and booking confirmation. Transcript terms produce stored alerts and optional queued notifications. The optional job worker handles deadlines, maintenance, and delivery. Native transports now cover the subset listed above, with other providers still requiring application work.

Existing workspaces retain legacy access until an owner opts into a managed plan. Draft plan prices of $19 and $69 follow the supplied screenshots and require commercial confirmation before payment activation. Payment and carrier requests await signed adapter events. Native provider adapters, OAuth, live WebRTC/voice/AI execution, configuration, visual acceptance, and end-to-end provider testing remain deferred. The generic HTTPS outbox is implemented, with dispatch disabled by default.

Platform admin console manages workspace approval, user access, provider connection metadata and encrypted credentials, and the Twilio inbound voice switch. Admin routes require both the designated owner account and the configured admin hostname.

On 2026-11-23 the user confirmed Render domain verification and certificates for ringonyx.com, www.ringonyx.com, app.ringonyx.com, and admin.ringonyx.com. The user reached Platform administration through the admin domain, signed into the customer dashboard through app.ringonyx.com, saw the marketing homepage at ringonyx.com, and confirmed the www redirect to the root. The user also confirmed that the admin path tested outside the admin hostname returned an Unknown endpoint error. These are user-reported browser checks.

Update this file after each feature. Record changes and verification in [RECORD_REGISTER.md](RECORD_REGISTER.md).

Phase 2 local acceptance passed on 2026-11-11. Carrier integration and live acceptance remain deferred.

Phase 3 local billing passed integration tests and browser acceptance on 2026-11-12. External booking confirmation, invoice delivery, and payment processing remain deferred.

Phase 4 local network passed integration tests and browser acceptance on 2026-11-12. External buyer bids, live carrier routing, and payout transfers remain deferred.

Phase 5 local web lead intake, routing, and reporting passed integration tests and browser acceptance on 2026-11-12. External chat providers and buyer delivery endpoints remain deferred.

Phase 6 local analytics and conversation workflows passed integration tests and browser acceptance on 2026-11-12. Audio transcription, model-backed analysis, and live voice answering remain deferred.

Phase 7 local operations passed integration tests on 2026-11-12. Outbound delivery, platform sync, and hosted monitoring remain deferred.

Phase 8 local release preparation passed on 2026-11-12. The production-mode test restored a SQLite snapshot on a fresh server and verified account access and persisted records. The README covers staging, acceptance, recovery, and rollback.

| Phase | Step | Feature | Status |
|---|---|---|---|
| Foundation | 01 | Local server and persistent SQLite database | Implemented |
| Foundation | 02 | Operator dashboard and local key access | Implemented |
| Site rentals | 03 | Tracking-site and number mapping | Implemented |
| Site rentals | 04 | Renter directory | Implemented |
| Site rentals | 05 | Historical renter assignments and handoffs | Implemented |
| Calls | 06 | Inbound routing simulator | Implemented |
| Calls | 07 | Call completion and call log | Implemented |
| Billing | 08 | Idempotent per-call qualification and charge recording | Implemented |
| Site rentals | 09 | Renter portal with scoped call and charge history | Implemented |
| Foundation | 10 | Workspace sign-in, roles, and tenant isolation | Implemented and tested locally |
| Calls | 11 | Carrier number provisioning | Search requests, quoted inventory, purchase reservations, and signed activation events implemented. Native carrier adapter deferred |
| Calls | 12 | Live forwarding and authenticated carrier callbacks | Implemented locally; carrier acceptance pending |
| Calls | 13 | Number porting | Port request queue and signed completion processing implemented. Carrier submission deferred |
| Attribution | 14 | Dynamic number insertion | Local number pools, visitor leases, and embed script implemented; carrier-backed pools deferred |
| Attribution | 15 | Visitor and campaign attribution | Local source and campaign capture verified on simulated calls |
| Calls | 16 | IVR builder | Local keypad menus applied to call simulations; carrier execution deferred |
| Calls | 17 | Fallback and ring-tree routing | Target editor, revisions, hours/ZIPs, weighted/round-robin/ring-all simulations implemented. Carrier execution deferred |
| Calls | 18 | Recording and consent settings | Local consent, audio upload, scoped playback, byte ranges, and retention maintenance implemented. Carrier audio capture deferred |
| Calls | 19 | Browser callbacks | Local request queue and cancellation implemented; dialing deferred |
| Calls | 20 | Inbound SMS | Local simulated inbox implemented; carrier delivery deferred |
| Billing | 21 | Recurring and hybrid rent | Local monthly rate schedules and invoice generation implemented |
| Billing | 22 | Verified booking-based charges | Operator verification and signed booking-result processing implemented. Native booking adapter deferred |
| Billing | 23 | Invoice generation and delivery | Local schedules, due dates, voiding, and email jobs implemented. External delivery configuration deferred |
| Billing | 24 | Payment reconciliation and dispute adjustments | Local payment, credit, and dispute resolution implemented |
| Network | 25 | Buyer contracts and portal | Implemented locally |
| Network | 26 | Buyer coverage, caps and concurrency limits | Implemented for simulated calls |
| Network | 27 | Publisher offers and portal | Implemented locally |
| Network | 28 | Publisher payout ledger and statements | Accrual, statements, payout reservations, and delivery jobs implemented. Transfers deferred |
| Network | 29 | Buyer ping/post and live bidding | Local contracts and timed bid request/response auctions implemented. Native buyer adapters and live connections deferred |
| Network | 30 | Publisher-side ping/post | Local authenticated endpoints implemented |
| Network | 31 | Predictive routing | Local historical revenue ranking implemented |
| Network | 32 | Traffic quality and suppression rules | Duplicate reference protection, regional suppression, partner pauses, and routing decisions implemented locally |
| Leads | 33 | Web form lead intake | Local hosted intake and campaign attribution implemented |
| Leads | 34 | Chat lead intake | Local asynchronous chat message intake implemented |
| Leads | 35 | Validation and deduplication | Contact validation and site-scoped deduplication implemented |
| Leads | 36 | Direct-post lead delivery | Local buyer inbox delivery implemented |
| Leads | 37 | Ping/post lead delivery | Local price quotes and buyer inbox delivery implemented |
| Analytics | 38 | Transcription | Transcript entry, recording-based requests, and signed result storage implemented. Transcription provider adapter deferred |
| Analytics | 39 | AI summaries and qualification | Local rules and human review plus signed model-result, scoring, and transcript alert workflows implemented. Model provider adapter deferred |
| Analytics | 40 | Conversation coaching | Suggested and editable coaching notes implemented locally |
| Analytics | 41 | AI answering | Local response configuration and simulation implemented; live voice integration deferred |
| Analytics | 42 | Campaign and financial reports | Local campaign, renter invoice, and network settlement reporting implemented |
| Integrations | 43 | Signed outbound webhooks | Durable signed HTTPS jobs, attempts, retries, and replay/cancel controls implemented. Dispatch configuration deferred |
| Integrations | 44 | Ad conversion exports | Local conversion CSV implemented. Ad platform sync deferred |
| Integrations | 45 | CRM integration | Local contact CSV implemented. CRM sync deferred |
| Integrations | 46 | CSV migration | Local tracking site import implemented |
| Integrations | 47 | Scoped developer API | Local site and campaign read scopes implemented |
| Integrations | 48 | MCP access | Local read-only stdio bridge implemented |
| Operations | 49 | White-label portals | Local workspace name and accent implemented |
| Operations | 50 | Audit log | Recent successful authenticated changes logged |
| Operations | 51 | Health monitoring and backups | Local health endpoint and SQLite snapshot command implemented. Hosted monitoring deferred |
| Release | 51a | Marketing homepage, interactive call walkthrough, and Ringonyx brand assets | Implemented, including buyer fallback, campaign attribution, and settlement demos |
| Release | 52 | GitHub source publication | Phases 1–8 published to main |
| Release | 53 | Staging deployment | User confirmed Render deployment and health check. New changes await deployment verification |
| Release | 54 | Acceptance testing | User confirmed hosted simulated call through renter invoice. New UI and live provider acceptance deferred |
| Release | 55 | Public launch | Launch checks documented. Public rollout deferred |

The local slice covers a tracked call from simulated arrival through qualified charge and renter handoff. Live forwarding and customer-ready billing remain open.

Post-audit follow-up adds optional daily buyer budgets with pending bid reservations, saved network routing and settlement evidence, and renter call details linked to invoices. Live provider work and the remaining account, routing, and billing features are pending.

Operators can edit existing buyer budgets and see reserved and settled amounts for the current UTC call day.

Operators can record deposits against a buyer contract. The first deposit activates prepaid routing for that buyer, and later calls reserve or consume available credit. Payment collection remains pending.

Network operators can generate itemized buyer invoices, resolve disputes submitted from scoped buyer portals, and apply manual payments and credits. Payment collection remains pending.

Local follow-up includes single-use renter invitations and sign-in, guided setup for an existing tracking number, busy/no-answer/after-hours fallback simulations, publisher pauses based on a daily missed-call threshold, and per-record call and web lead evidence.

Added a dedicated renter-call record with qualification explanation and exact invoice-line navigation, a workspace activity timeline, and saved buyer exclusions and ranking evidence with configurable predictive trials. Earlier call completions and settlements lack event timestamps, and earlier routing audits retain their original evidence.

Render staging preparation adds configurable `RINGONYX_HOST`. Set it to `0.0.0.0` on Render. Hosted deployment and acceptance are pending.
