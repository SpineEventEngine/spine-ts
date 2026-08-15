# T-0189: Wave 12 Browser Fix At The Proven Owner

Status: COMPLETE

T-0188 classification (2026-08-15): the owner is `interop/envoy/render.mjs`.
The exact CORS preflight path is unmatched because its generated route set is
POST-only. T-0189 may now make the smallest test-first renderer correction;
native server, Gateway, and browser client code remain out of scope.

Implemented correction: exact OPTIONS routes accompany each bounded RPC route,
allowing Envoy's existing origin-restricted CORS filter to answer preflight
without forwarding it to the Gateway.

Review correction: OPTIONS matches now use terminal local 204 responses rather
than Gateway routes; accepted preflight therefore cannot inherit request or
stream routing. Browser evidence returns a stable serialized update identity
and the passive viewer asserts three distinct states. Cancellation is attempted
from the test `finally` before page/context closure.

Only the runtime family proven by T-0188 may be changed: native server/Stand,
Gateway relay/bindings, or browser consumption. The regression requires a
passive real-browser viewer to receive three writer-originated updates through
Envoy and Gateway. The changed lifecycle branches require >=90% line and
branch coverage, with real-browser evidence recorded separately from V8.

Remaining acceptance evidence is limited to the browser harness: it must record
one healthy binding/native-stream snapshot after each of three distinct ordered
external-writer updates, and the forced viewer-disconnect case must wait for
zero bindings and active native streams before topology closure. A fresh
complete Chromium run is required to capture the final result.
