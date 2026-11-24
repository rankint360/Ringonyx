# Resend email transport

Implemented 2026-11-24. No credentials configured or outbound messages sent during implementation.

Use the existing `email` provider with transport `native` and endpoint `https://api.resend.com/emails`. Encrypted credentials use this shape, with real values entered privately in the application.

```json
{
  "service": "resend",
  "apiKey": "YOUR_RESEND_API_KEY",
  "from": "Ringonyx <notifications@ringonyx.com>",
  "appOrigin": "https://app.ringonyx.com"
}
```

Verify the sender domain in Resend first. Add the DNS values supplied by Resend to the authoritative Cloudflare DNS zone. Use a sending-only API key restricted to that domain where available.

The server requires its vault key before saving credentials. Add `api.resend.com` to the existing delivery hostname allowlist without removing other intended hosts. Keep global dispatch paused until reviewing queued jobs and arranging the worker. Merely enabling a connection does not start a worker. Resend reuses each delivery job's stable Idempotency-Key header. This does not guarantee deduplication beyond Resend's retention window.

Supported templates are registration pending, account approval, password recovery and invoice text. Existing SendGrid connections remain compatible because omitted service defaults to SendGrid. Sending a generic connection test is not supported by the email template handler.

Sources

- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/dashboard/emails/idempotency-keys
