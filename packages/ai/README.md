# Spine AI facade

Application developers use this package to define typed Agent capabilities and
configure deployments before building a server context. Model definitions,
registrations, decision answers, and Protobuf output candidates can be checked
without a provider credential or a model request.

The smallest useful check is:

```sh
pnpm exec vitest run packages/ai/test
```

It should pass the facade's behavior tests without network access. See
[REFERENCE.md](REFERENCE.md) for the supported contracts and current limits.
