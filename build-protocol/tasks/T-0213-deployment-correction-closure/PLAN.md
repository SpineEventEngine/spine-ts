# T-0213 execution plan

1. Correct release plumbing and removal guards for deleted ZeroMQ/generic
   routing acceptance.
2. Reconcile only current Todo/deployment guidance directly affected by the
   correction.
3. Run cheap generated/tooling/policy/documentation preflight.
4. Run serialized managed lifecycle, subscription, Delivery, external-event,
   Todo, image-contract, one-node Compose, and distributed Compose acceptance.
5. Review only affected style, TypeScript/API, documentation, and reliability
   concerns; return one correction batch if needed.
6. Run the required repository release verification once after convergence.
7. Merge into isolated `main`, post-merge verify, push, and remove only the
   clean merged correction branch/worktree.

Security findings, dependency maintenance, Gateway quota/rollout behavior, and
unrelated release-status work are outside this plan.
