# Ringonyx build status

Update this file after each feature. Record changes and verification in [RECORD_REGISTER.md](RECORD_REGISTER.md).

Phase 2 local acceptance passed on 2026-11-11. Carrier integration and live acceptance remain deferred.

Phase 3 local billing passed integration tests and browser acceptance on 2026-11-12. External booking confirmation, invoice delivery, and payment processing remain deferred.

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
| Network | 32 | Traffic quality and suppression rules | Duplicate references and regional suppression implemented locally |
| Leads | 33 | Web form lead intake | Pending |
| Leads | 34 | Chat lead intake | Pending |
| Leads | 35 | Validation and deduplication | Pending |
| Leads | 36 | Direct-post lead delivery | Pending |
| Leads | 37 | Ping/post lead delivery | Pending |
| Analytics | 38 | Transcription | Pending |
| Analytics | 39 | AI summaries and qualification | Pending |
| Analytics | 40 | Conversation coaching | Pending |
| Analytics | 41 | AI answering | Pending |
| Analytics | 42 | Campaign and financial reports | Pending |
| Integrations | 43 | Signed outbound webhooks | Pending |
| Integrations | 44 | Ad conversion exports | Pending |
| Integrations | 45 | CRM integration | Pending |
| Integrations | 46 | CSV migration | Pending |
| Integrations | 47 | Scoped developer API | Pending |
| Integrations | 48 | MCP access | Pending |
| Operations | 49 | White-label portals | Pending |
| Operations | 50 | Audit log | Pending |
| Operations | 51 | Health monitoring and backups | Pending |
| Release | 51a | Marketing homepage, interactive call walkthrough, and Ringonyx brand assets | Implemented |
| Release | 52 | GitHub prototype source push | Complete |
| Release | 53 | Staging deployment | Pending |
| Release | 54 | Live acceptance testing | Pending |
| Release | 55 | Public launch | Pending |

The local slice covers a tracked call from simulated arrival through qualified charge and renter handoff. Live forwarding and customer-ready billing remain open.
