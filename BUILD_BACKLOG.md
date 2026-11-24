# Ringonyx application backlog

Updated 2026-11-23. This is a source implementation checkpoint, not a claim of release readiness. Configuration and verification are deferred at the owner's request.

## Implemented in this build

- Native transport selection alongside the existing signed gateway transport. Existing connections retain gateway behavior.
- SendGrid registration, approval, password recovery and invoice text emails. Recovery links use the application token fragment and a configured trusted origin.
- Slack incoming webhook alert formatting.
- HubSpot email-keyed contact upserts for captured leads. Call activity sync is still open.
- External lead delivery in JSON and URL-encoded form formats with optional bearer authentication.
- Twilio available-number search with US/Canada and local/toll-free filters, explicit configured retail quotes, and local result application.
- Twilio caller name and line-type lookup with local result application.
- OpenAI recording transcription from account-scoped retained audio and structured transcript analysis. The model is explicitly configured. Result validation, alerts, usage and configured billing review reuse the existing application workflows.
- Buyer JSON/form bid requests, buyer-specific endpoints and tokens, integer-cent response field mapping, deadline-limited fetches, and local auction result application.
- Concurrent bounded batches of up to ten delivery jobs with existing worker lease fencing.
- Bounded provider JSON response consumption and account-scoped result application.
- Visitor page/referrer paths, UTM medium/term/content and Google/Meta click identifiers are retained with the lease and snapshotted onto calls. Completed-call delivery includes that attribution.

No connections or credentials were added. Dispatch remains controlled by the existing server switch and hostname allowlist.

## Application code still open

- Native carrier purchase, release, porting, outbound calls, inbound SMS, carrier audio ingestion, browser WebRTC dialing, and live advanced IVR/ring-tree execution.
- Native checkout, payment webhook verification, recurring collection, refunds, customer payment methods, connected payout onboarding and transfers. Existing financial ledgers and gateway contracts remain implemented.
- Google Ads and Meta conversion submission, Salesforce activity sync, OAuth authorization/refresh, and provider-specific booking confirmation.
- XML bidder parsing, buyer schemas beyond JSON/form integer-cent responses, and real-time publisher call bridging.
- Live AI answering, advanced flow branches/experiments, automated call-spike enforcement and external suppression screening.
- Full white-label logo assets and tenant domain routing, broader write-scoped developer API, scheduled monitoring/backup management, and detailed dial insights.
- Full screenshot layout parity and remaining specialized dashboard controls.

## Deferred work

Provider credentials, configuration, DNS changes, provider activation, automated regression execution, browser checks, live call/payment acceptance and public release verification are deferred. Only JavaScript syntax checks were performed for this build.

## API references used

- https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource
- https://www.twilio.com/docs/lookup/v2-api
- https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
- https://api.slack.com/messaging/webhooks
- https://github.hubspot.com/hubspot-api-nodejs/classes/crm_contacts.BatchApi.html
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create/
