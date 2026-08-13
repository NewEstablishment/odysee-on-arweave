# Homepage HyperBEAM Request Shape

This document records the pre-multirequest materializer request shape for
performance analysis. It is historical, not the current architecture. The
replacement design is in
`aidocs/homepage-ao-core-architecture.md`; it uses direct immutable AO-Core
resolutions through a generic Lua application and removes the per-object custom
cache namespace from the homepage path.

The old homepage materializer made the following HyperBEAM requests through
`~cache@1.0/read`.

## 1. Category discovery

There is one request per category. English currently has 17 categories, plus
one additional pinned-claim request.

```http
POST /~cache@1.0/read
Content-Type: application/json

{
  "read": "odysee/source-claims/%7B%22claim_type%22%3A%5B%22stream%22%5D%2C%22order_by%22%3A%5B%22release_time%22%5D%2C%22page%22%3A1%2C%22page_size%22%3A36%2C%22limit_claims_per_channel%22%3A1%2C%22timestamp%22%3A%22%3E...%22%2C%22release_time%22%3A%22%3C...%22%7D"
}
```

The encoded value is equivalent to:

```json
{
  "claim_type": ["stream"],
  "order_by": ["release_time"],
  "page": 1,
  "page_size": 36,
  "limit_claims_per_channel": 1,
  "timestamp": ">1778767017",
  "release_time": "<1786543017"
}
```

The materializer requests three times the displayed row size so unavailable
objects can be replaced without publishing an incomplete row.

## 2. Banner resolution

English currently has five requests like:

```http
POST /~cache@1.0/read
Content-Type: application/json

{
  "read": "odysee/source-resolve/lbry%3A%2F%2F..."
}
```

## 3. Channel resolution

Selected media contain signing-channel claim IDs. The materializer resolves
those IDs in chunks of 24:

```http
POST /~cache@1.0/read
Content-Type: application/json

{
  "read": "odysee/source-claims/%7B%22claim_ids%22%3A%5B%22...%22%2C%22...%22%5D%2C%22page%22%3A1%2C%22page_size%22%3A24%7D"
}
```

## 4. Local immutable-object presence

The materializer currently makes one request per selected media or channel
object:

```http
POST /~cache@1.0/read
Content-Type: application/json

{
  "read": "odysee/local-object/QC-ghgwx1M-XpINZYi_c1IK19HJpWPI_bKxTnxwI6OA"
}
```

Response:

```json
{
  "present": true
}
```

The latest English snapshot checked 179 unique media objects and 161 unique
channels. This phase alone therefore produces approximately 340 small HTTP
requests.

## 5. Import missing objects

Missing legacy outpoints are queued in chunks of 24:

```http
POST /~cache@1.0/read
Content-Type: application/json

{
  "read": "odysee/import-claims/%5B%22txid%3A0%22%2C%22txid%3A1%22%5D"
}
```

The materializer then checks the missing immutable IDs again.

## Implemented replacement

The generic Lua application now accepts an ordered array of AO-Core
subrequests, resolves each with `ao.resolve`, and returns ordered per-item
results and errors. One failed item does not fail the entire batch.

A possible generic request shape is:

```json
{
  "requests": [
    {
      "path": "/~cache@1.0/read",
      "body": {
        "path": "/IMMUTABLE_ID_1"
      }
    },
    {
      "path": "/~cache@1.0/read",
      "body": {
        "path": "/IMMUTABLE_ID_2"
      }
    }
  ],
  "concurrency": 24
}
```

`~lua@5.3a` orchestrates the batch without requiring a custom trusted device.
Snapshot publication writes one signed immutable message per language and
hour. Runtime discovery uses generic query, direct immutable reads, exact
commitment verification, and expected-committer checks.

This removes the hundreds of individually transported local-object reads that
dominated the old request shape.
