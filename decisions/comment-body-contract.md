# Decision: native comment text is the message body

## Context

Native comments originally stored text under a product-specific `comment`
field. An exact read by message ID therefore did not behave like reading the
comment document itself. Moving text to `body` exposed an upstream auth bug:
the hosted-wallet verifier reused the entire application request as its own
verification request and tried to interpret a string body as a message map.

## Decision

New `odysee-comment@1.0` roots, replies, edits, and deletes use `body` for their
text. Readers remain compatible with `comment` and `text` records already in
the store.

Cookie credential verification strips the application body from its internal
verification request. After credential verification, the auth hook signs the
complete application message, including `body`, through the normal committed
`POST /id?!=true&committers=all` flow.

## Consequences

- `GET /<comment-message-id>` exposes the comment as the document body.
- Comment content remains covered by the resulting RSA-PSS commitment.
- No comment device, Commentron fallback, or body-specific frontend transport
  is introduced.
