# Telnyx staged integration

2026-11-24 introduces inventory search only. Live forwarding, authenticated callbacks, number purchase/release, porting, recordings and messaging remain pending. Do not enable purchase based on this search adapter.

Use provider `carrier`, transport `native`, endpoint `https://api.telnyx.com/v2/available_phone_numbers`, and encrypted credentials with `service` set to `telnyx` and `apiKey` set privately. Keep the connection disabled until setup review. The server host allowlist must include `api.telnyx.com` while preserving `api.resend.com` for email.

Search supports US/Canada, local/toll-free, area code, city and voice capability. Approximate matches are disabled and filtered from results. Quotes require Telnyx-returned USD monthly and upfront costs. Conversion uses integer decimal arithmetic, rounding fractional cents upward to fit the existing cent-based ledger. Missing prices or other currencies fail rather than inventing a quote. Existing quotes expire after five minutes.

No Telnyx secret was received, configured or used during this build. Parser checks only. Live search acceptance is a separate setup step.

References

- https://telnyx.com/products/phone-numbers
- https://github.com/team-telnyx/telnyx-node/blob/master/src/resources/available-phone-numbers.ts
- https://github.com/team-telnyx/telnyx-node/blob/master/src/resources/shared.ts
