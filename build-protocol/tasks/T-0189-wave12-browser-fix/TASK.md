# T-0189: Wave 12 Browser Fix At The Proven Owner

Status: BLOCKED ON T-0188 CLASSIFICATION

Only the runtime family proven by T-0188 may be changed: native server/Stand,
Gateway relay/bindings, or browser consumption. The regression requires a
passive real-browser viewer to receive three writer-originated updates through
Envoy and Gateway. The changed lifecycle branches require >=90% line and
branch coverage, with real-browser evidence recorded separately from V8.
