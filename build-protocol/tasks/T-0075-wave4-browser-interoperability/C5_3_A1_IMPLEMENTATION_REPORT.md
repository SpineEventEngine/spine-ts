# C5.3 A1 implementation report

`UnaryGatewayOptions.registry` is an optional fixed application registry used
only for independent command decoding at policy/context seams. It is absent
from forwarding. Registered content is independently decoded; missing, unknown,
and malformed content remains safe and undecoded.

The gateway snapshots its options at construction. A RED/GREEN regression holds
session resolution pending, swaps the caller-retained registry, and proves the
source decode plus independent policy/context command views continue to use the
construction-time registry; forwarded bytes remain unchanged and the registry
is never forwarded.

Focused tests cover policy mutation isolation, forwarded-byte preservation,
missing/unknown/malformed content with retained type URLs, and existing request
limits/cancellation. A real `createNativeGatewayServices()` composition uses a
real configured `UnaryGateway`, proves native Post policy receives decoded
application content, and proves the backend forwarder runs once without a
registry or credential.
The configured role/profile is `implementer` / `gpt-5.6-terra` / `medium`;
runtime self-introspection is unavailable on this surface.

Focused coverage passes 48 tests at 93.93% branches. Package TypeScript,
Prettier, and diff hygiene pass. The exact requested typed ESLint command still
reports 36 pre-existing `require-await`, `no-non-null-assertion`, and one
unused-fixture violation in the untouched unary/native test fixtures; diff-aware
inspection confirms this correction introduces none.
