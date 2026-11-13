# Ringonyx build status

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
| Calls | 11 | Carrier number provisioning | Local area-code request drafts implemented; carrier purchase deferred |
| Calls | 12 | Live forwarding and authenticated carrier callbacks | Implemented locally; carrier acceptance pending |
| Calls | 13 | Number porting | Local number port request drafts implemented; carrier submission deferred |
| Attribution | 14 | Dynamic number insertion | Local number pools, visitor leases, and embed script implemented; carrier-backed pools deferred |
| Attribution | 15 | Visitor and campaign attribution | Local source and campaign capture verified on simulated calls |
| Calls | 16 | IVR builder | Local keypad menus applied to call simulations; carrier execution deferred |
| Calls | 17 | Fallback and ring-tree routing | Local ordered fallback applied to call simulations; carrier execution deferred |
| Calls | 18 | Recording and consent settings | Local disclosure and consent decisions applied to simulated calls; audio capture and playback deferred |
| Calls | 19 | Browser callbacks | Local request queue and cancellation implemented; dialing deferred |
| Calls | 20 | Inbound SMS | Local simulated inbox implemented; carrier delivery deferred |
| Billing | 21 | Recurring and hybrid rent | Local monthly rate schedules and invoice generation implemented |
| Billing | 22 | Verified booking-based charges | Local operator verification and booking charges implemented; external booking confirmation deferred |
| Billing | 23 | Invoice generation and delivery | Local call, rent, and booking invoices visible in renter portal; external delivery deferred |
| Billing | 24 | Payment reconciliation and dispute adjustments | Local payment, credit, and dispute resolution implemented |
| Network | 25 | Buyer contracts and portal | Implemented locally |
| Network | 26 | Buyer coverage, caps and concurrency limits | Implemented for simulated calls |
| Network | 27 | Publisher offers and portal | Implemented locally |
| Network | 28 | Publisher payout ledger and statements | Local accrual and statements implemented; disbursement deferred |
| Network | 29 | Buyer ping/post and live bidding | Local bids and floors implemented; external buyer responses deferred |
| Network | 30 | Publisher-side ping/post | Local authenticated endpoints implemented |
| Network | 31 | Predictive routing | Local historical revenue ranking implemented |
| Network | 32 | Traffic quality and suppression rules | Duplicate reference protection, regional suppression, partner pauses, and routing decisions implemented locally |
| Leads | 33 | Web form lead intake | Local hosted intake and campaign attribution implemented |
| Leads | 34 | Chat lead intake | Local asynchronous chat message intake implemented |
| Leads | 35 | Validation and deduplication | Contact validation and site-scoped deduplication implemented |
| Leads | 36 | Direct-post lead delivery | Local buyer inbox delivery implemented |
| Leads | 37 | Ping/post lead delivery | Local price quotes and buyer inbox delivery implemented |
| Analytics | 38 | Transcription | Local transcript entry and review implemented; audio transcription deferred |
| Analytics | 39 | AI summaries and qualification | Local excerpts, booking-intent rules, and human review implemented; model integration deferred |
| Analytics | 40 | Conversation coaching | Suggested and editable coaching notes implemented locally |
| Analytics | 41 | AI answering | Local response configuration and simulation implemented; live voice integration deferred |
| Analytics | 42 | Campaign and financial reports | Local campaign, renter invoice, and network settlement reporting implemented |
| Integrations | 43 | Signed outbound webhooks | Local audit event signing implemented. Outbound delivery deferred |
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
| Release | 53 | Staging deployment | Deployment and rollback procedures documented. Hosted rollout deferred |
| Release | 54 | Acceptance testing | Local tests passed. Hosted and live provider acceptance deferred |
| Release | 55 | Public launch | Launch checks documented. Public rollout deferred |

The local slice covers a tracked call from simulated arrival through qualified charge and renter handoff. Live forwarding and customer-ready billing remain open.

Post-audit follow-up adds optional daily buyer budgets with pending bid reservations, saved network routing and settlement evidence, and renter call details linked to invoices. Live provider work and the remaining account, routing, and billing features are pending.

Operators can edit existing buyer budgets and see reserved and settled amounts for the current UTC call day.

Operators can record deposits against a buyer contract. The first deposit activates prepaid routing for that buyer, and later calls reserve or consume available credit. Payment collection remains pending.

Network operators can generate itemized buyer invoices from settled charges and record and resolve invoice disputes. Buyers can view invoices and dispute outcomes in their scoped portals. Buyer self-service dispute submission, financial adjustments, and payment reconciliation remain pending.
