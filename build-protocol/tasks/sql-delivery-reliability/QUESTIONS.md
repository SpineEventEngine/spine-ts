# Unresolved decisions

No implementation blocker is established. The accepted architecture supports finite Event-only retry and explicit repair of known committed Event IDs. It does not claim automatic discovery of every interrupted publication and introduces no new persistence contract.

Final CI constraint: `.github/workflows/build.yml` runs only for pull requests targeting master and has no manual-dispatch trigger. The user has not authorized creating a pull request. Complete implementation, local verification, review, versioning and pushes first; do not create a PR or alter CI triggers to bypass that boundary. Required PR-based CI remains a final verification limitation until a human requests or creates the PR.
