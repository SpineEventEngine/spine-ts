# ZeroMQ Multipart Aggregate-Limit Research

Status: Post-completion research record

Date: `2026-07-15`

Related decision: [D-0093](../DECISION_LOG.md#d-0093-use-protobuf-wire-encoding-and-accept-multipart-trailer-risk)

Related task: [T-0043](../tasks/T-0043-zeromq-multipart-upstream-research/TASK.md)

## Question

Spine TS uses zeromq.js 6.5.0 for private same-host IPC. Its normal command and
event signal is a two-frame ZeroMQ message:

1. routing key;
2. Buf-encoded Protobuf signal envelope.

Each inbound frame has an 8,388,608-byte hard limit. Application code consumes
only the protocol-defined prefix and ignores later multipart frames. The
remaining question, recorded as SF-013, is whether a peer can append an
unbounded number of individually valid frames and cause native/Node memory use
before Spine TS can ignore them.

This report asks:

- Is that behavior known in ZeroMQ or zeromq.js?
- Is there an existing aggregate multipart byte or frame-count limit?
- Which proposed workarounds actually prevent allocation, and which act only
  after allocation?
- Does Spine TS appear to have found a previously undocumented limitation?

## Human Comments And Decisions

The design changed after the human challenged two earlier assumptions:

- "The 8MiB size just to send signals is bullshit. They are typically tiny."
- "Buf's implementation has Proto-compatible serialization mechanism. I don't
  understand why we don't use that, but use some generic V8 stuff. This is also
  not OK to me."

The human then made the wire and risk decisions explicit:

- "Use Buf's serialization, not V8's when dealing with Proto messages."
- "Keep 8 MiB as a hard upper limit."
- "Take only two first frames from the payload. Ignore the rest."
- "On this stage I don't care if someone breaks into our ZeroMQ server and
  feeds a lot of junk to it."
- After project completion, inspect known ZeroMQ issues and discussions and
  report whether this behavior and its workarounds were already known.

These statements are not paraphrased product requirements. They are the
human's recorded comments and accepted decisions.

## Implemented Boundary And Reasoning

### Serialization

Command and event signals are Protobuf messages. Spine TS therefore uses the
generated Buf schemas and Protobuf binary wire encoding for those signals.
Node's V8 serializer remains private to non-Protobuf adapter traffic where the
wire type is intentionally Node-specific; it does not encode or decode
Protobuf command/event signal envelopes.

This makes the transport bytes match the declared schema and avoids promising
Protobuf compatibility while actually sending a Node-runtime object encoding.

### The 8 MiB value

The 8 MiB value is a hard rejection ceiling, not a buffer reservation and not
the expected size of a signal. `maxMessageSize = 8_388_608` tells libzmq to
reject an individual inbound frame larger than that value. A 70-byte routing
key and a 300-byte signal still use small buffers corresponding to their actual
sizes; dispatch does not allocate two 8 MiB buffers.

The value was selected as conservative headroom over the server's existing
4,194,304-byte default request/response message bound. It is deliberately much
larger than normal command/event signals so it rejects pathological frames
without turning the transport ceiling into a routine throughput constraint.
It is not evidence that ordinary signals should approach 8 MiB.

### Prefix-only semantics

For the Spine TS protocol, the first two publish/request frames are meaningful:
routing plus the serialized signal. A reply has one meaningful reply frame.
Later frames are ignored so they cannot change application routing, decoding,
or callback semantics.

Ignoring trailers is an application-semantic rule. It is not described as an
allocation defense because zeromq.js has already received the complete
multipart message before Spine TS can select its prefix.

## Upstream Facts

### Multipart messages are atomic and memory-resident

Official ZeroMQ documentation defines a message as one or more frames, promises
all-or-none delivery, and says that a single or multipart message must fit in
memory. It explicitly warns that multipart data does not reduce memory
consumption ([ZeroMQ Messages](https://zeromq.org/messages/)).

ZMTP 3.1 encodes the `MORE` bit in each frame and defines a message as one or
more frames. It requires implementations to send and deliver all frames of a
message atomically ([ZMTP 3.1, Framing and Messages](https://rfc.zeromq.org/spec/37/)).
The related libzmq discussion confirms the receive-side rule that once the
first part is available at the socket, the remaining parts can be received
without blocking ([libzmq issue 2269](https://github.com/zeromq/libzmq/issues/2269)).

This means the general whole-message memory property is known behavior, not a
Spine TS discovery.

### `ZMQ_MAXMSGSIZE` is not an aggregate multipart limit

The public option documentation says `ZMQ_MAXMSGSIZE` limits the size of an
inbound message and disconnects a peer that exceeds it
([libzmq `zmq_setsockopt`](https://libzmq.readthedocs.io/en/latest/zmq_setsockopt.html#zmq-maxmsgsize-maximum-acceptable-inbound-message-size)).
ZeroMQ terminology can make the word "message" ambiguous here. The decoder
implementation resolves the ambiguity: it reads one frame's flags, records
the `MORE` bit, reads that frame's size, and compares that size independently
with `_max_msg_size` before allocating the frame body
([libzmq v2 decoder](https://github.com/zeromq/libzmq/blob/master/src/v2_decoder.cpp#L35-L75)).

Therefore the configured 8 MiB limit rejects each oversized frame before its
body allocation. It does not count the number of frames and does not sum bytes
across a multipart message.

### zeromq.js materializes the complete multipart message

zeromq.js documents `receive()` as a promise resolving to an array containing
all parts of the next single or multipart message
([zeromq.js `Request.receive`](https://zeromq.github.io/zeromq.js/classes/Request.html#receive)).
In version 6.5.0, the native receive loop repeatedly calls `zmq_msg_recv`,
converts each part into a Node buffer, checks `zmq_msg_more`, and resolves only
after the last part
([zeromq.js 6.5.0 `Socket::Receive`](https://github.com/zeromq/zeromq.js/blob/93bd72fdef2d085d8e1a6753c7d55a7fdb85427b/src/socket.cc#L314-L350)).

An earlier zeromq.js discussion states the same behavior in direct terms: the
callback runs only when all frames are available, and ignoring later callback
arguments merely discards frames that were still passed to the callback
([zeromq.js issue 221](https://github.com/zeromq/zeromq.js/issues/221#issuecomment-358082140)).

Consequently, array destructuring such as `const [route, signal] = await
receive()` does not ask zeromq.js or libzmq to receive only two frames. It
selects two buffers from an array that the binding has already completed.

### High-water marks do not provide an aggregate byte cap

`ZMQ_RCVHWM` limits the number of outstanding incoming messages queued per
peer; its unit is messages, not bytes or frames
([libzmq `ZMQ_RCVHWM`](https://libzmq.readthedocs.io/en/latest/zmq_getsockopt.html#zmq-rcvhwm-retrieve-high-water-mark-for-inbound-messages)).
Because a multipart sequence is delivered as one atomic message, a low HWM can
bound queued message count but does not convert the per-frame size ceiling into
an aggregate multipart byte or frame-count ceiling.

## Workaround Assessment

### Effective for the exact risk

1. **Prevent the peer from connecting.** OS-level IPC isolation, separate
   service users, endpoint permissions, or ZeroMQ authentication can reduce the
   set of processes able to send frames. ZAP is ZeroMQ's protocol for server-
   side client authentication ([ZeroMQ RFC 27](https://rfc.zeromq.org/spec/27/)).
   This does not help against an already-authorized or same-UID peer that is
   inside the accepted trust boundary.
2. **Add a native aggregate multipart limit.** An exact control would need to
   count frames and cumulative bytes per inbound multipart message in libzmq's
   receive/session path and disconnect or discard before allocating a frame
   that crosses the configured aggregate. No such stable socket option was
   found in the inspected libzmq or zeromq.js interfaces. This implies an
   upstream libzmq change, a maintained fork, or a replacement ZMTP/native
   transport path.
3. **Remove multipart capability at the native protocol boundary.** Some newer
   thread-safe ZMTP socket types specify that multipart messages are disallowed
   and discarded. That is not a drop-in replacement for Spine TS PUB/SUB and
   REQ/REP semantics, and the inspected sources do not establish that discard
   happens before all native frame allocation. It is therefore an architecture
   alternative to investigate, not a proven current workaround.

### Useful containment, but not an exact fix

1. **Per-frame `ZMQ_MAXMSGSIZE`.** This prevents one huge frame and remains a
   worthwhile hard limit. It does not prevent many individually valid frames.
2. **Receive high-water marks.** These bound queued message count, not aggregate
   bytes inside one multipart message.
3. **One-frame application encoding.** Encoding routing and payload into one
   conforming frame would simplify valid traffic, but a malicious ZMTP peer can
   still set `MORE` and append trailers. It is not an adversarial aggregate
   bound unless the native receiver rejects multipart before allocation.
4. **Application checks, destructuring, or ignored trailers.** These keep
   routing and decoding deterministic and can avoid additional application
   work. They execute after libzmq/zeromq.js receive and therefore cannot undo
   native buffers already created.
5. **A custom zeromq.js loop that stops exporting buffers after two parts.**
   This could reduce Node/V8 buffer materialization for later parts, but libzmq
   atomic delivery means the native message has already been accepted into its
   receive path. It is defense in depth, not proof of a pre-allocation bound.
6. **Process memory/resource limits and restart supervision.** These can contain
   the blast radius of memory exhaustion, but they turn exhaustion into process
   termination rather than preventing the malformed multipart message.

## Prior-Report And Novelty Finding

The public material clearly predates Spine TS on the important underlying
facts:

- multipart messages are atomic and must fit in memory;
- all remaining parts are available once receive exposes the first part;
- zeromq.js presents the complete multipart message to JavaScript;
- ignoring unused parts does not mean those parts were never received.

The research did **not** find a zeromq.js or libzmq issue, discussion, stable
option, or accepted proposal specifically describing all of the following as
one limitation:

1. `ZMQ_MAXMSGSIZE` applies independently to each frame;
2. multipart frame count and aggregate bytes remain unbounded by that option;
3. zeromq.js 6.5.0 converts every part to `Buffer` before JavaScript can enforce
   a protocol prefix; and
4. the binding exposes no pre-materialization frame-count or aggregate-byte
   control.

Searches were run on `2026-07-15` across public zeromq.js and libzmq issues and
general indexed ZeroMQ documentation/discussions with combinations of
`maxMessageSize`, `MAXMSGSIZE`, `multipart`, `allocation`, `memory`, `RCVMORE`,
`frame limit`, `message parts limit`, and denial-of-service terms. Related
atomicity and memory reports were inspected, including zeromq.js issue 221 and
libzmq issue 2269. No exact report appeared.

The defensible conclusion is therefore:

- **We are not the first to discover the underlying whole-multipart memory
  behavior.** It is intentional, documented ZeroMQ behavior.
- **The exact aggregate-limit gap appears not to be prominently documented or
  tracked as a dedicated zeromq.js/libzmq limitation in the searched public
  sources.** Spine TS may have articulated a previously unreported combination
  of known behaviors, but search absence cannot prove priority or novelty.

An upstream issue with a minimal reproducer would be the appropriate way to ask
maintainers whether an aggregate cap already exists outside the public API or
whether they would accept one. The human did not request filing an issue, and
this report performs no irreversible external action.

## Spine TS Release Disposition

The research does not change D-0093 or reopen the accepted initial release:

- Buf binary remains the command/event signal encoding.
- 8 MiB remains the per-frame hard ceiling and does not imply fixed-size
  allocation.
- Receivers consume the protocol-defined prefix and ignore trailers for
  deterministic application behavior.
- SF-013 remains an accepted same-host availability residual for a process that
  can reach the private endpoint.
- A future hardening milestone may evaluate authenticated IPC identities or a
  native aggregate multipart limit if the trust model changes.
