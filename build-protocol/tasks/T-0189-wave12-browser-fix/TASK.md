# T-0189: Wave 12 Browser Fix At The Proven Owner

Status: BLOCKED ON T-0188 CLASSIFICATION

T-0188 classification (2026-08-15): the owner is `interop/envoy/render.mjs`.
The exact CORS preflight path is unmatched because its generated route set is
POST-only. T-0189 may now make the smallest test-first renderer correction;
native server, Gateway, and browser client code remain out of scope.

Only the runtime family proven by T-0188 may be changed: native server/Stand,
Gateway relay/bindings, or browser consumption. The regression requires a
passive real-browser viewer to receive three writer-originated updates through
Envoy and Gateway. The changed lifecycle branches require >=90% line and
branch coverage, with real-browser evidence recorded separately from V8.
