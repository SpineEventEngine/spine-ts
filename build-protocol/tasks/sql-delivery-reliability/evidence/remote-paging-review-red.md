# Authored paging review correction RED

Focused command: `pnpm exec vitest run packages/delivery-client/test/client-rpc-lifecycle.test.ts -t 'repeated message ID|invalid peer timestamp'`.

Before the correction, both new tests failed (2 failed, 31 skipped). A page containing the same Inbox message ID at receive times 1 and 2 seconds resolved with both rows; its tuple order alone was increasing. A peer response with `whenReceived.seconds = 253402300800` rejected with a raw `TypeError: Delivery inbox timestamp is invalid.` rather than a `DeliveryProtocolError` carrying that cause. The failures were produced through the mocked RPC response, not malformed local request input.

After the correction, the same two tests passed; the full affected three-suite run passed 50/50 in `remote-paging-review-green.log`.
