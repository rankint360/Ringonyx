# Ringonyx

Track, route, and monetize inbound leads.

## Run locally

Requires Node.js 24 or later. From this directory run `npm start`, then open http://127.0.0.1:3000. The default operator key is `local-demo`. Set `RINGONYX_OPERATOR_KEY` to override it. SQLite stores data in `data/ringonyx.sqlite`. Use `npm test` for the API integration check.

Add a tracking site and two renters. Assign the first renter with a charge in cents and minimum talk time. Simulate an arrival, reassign the site, then complete the call. Open each renter portal to inspect the allocation and charges. Simulate another call to confirm the new destination.

This local application simulates carrier events and displays accumulated charges. Real call connectivity, invoice issuance, production authentication, and the other features listed in STATUS.md are pending. Renter links are bearer credentials in this prototype.

The product homepage is at `/` and the operator console is at `/app`. The homepage demo uses sample data and does not change the console database.
