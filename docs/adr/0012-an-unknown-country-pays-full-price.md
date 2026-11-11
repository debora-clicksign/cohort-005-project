# A buyer whose country is unknown pays full price

Purchasing-power prices depend on the buyer's country, which `resolveCountry` reads only from the `CF-IPCountry` header. When a request doesn't carry it, the buyer pays full price. This overcharges some of the Students purchasing-power pricing is for, but no page ever waits on a network call to learn the country.

## Considered Options

- **Look up the first `X-Forwarded-For` address on ip-api.com.** Rejected: the course list, the purchase page and every lesson page would wait on a plain-HTTP call to a free endpoint limited to 45 requests a minute. This was ADR-0008.
- **Bundle a MaxMind GeoLite2 database.** Rejected: it needs a licence key, a download of tens of megabytes, and an update every month.
