# M05 documentation review

Returned by app_query_m03_docs, existing documentation_reviewer with immutable
explicit gpt-6-luna / medium profile. Runtime metadata is unavailable. Main
transcribes the read-only report; no source edits or broad test reruns.

The TASK ledger and current metadata/bootstrap workflow were checked.

1. docs/USER_GUIDE.md around line 267 still says build() loads the generated
   registry. The Todo guide likewise describes createTodoContext() loading a
   compiled registry from the package root and a missing/unreadable file.
   Explain static generated/spine-bootstrap.js import before assembly and the
   missing-class metadata diagnostic instead. The first point duplicates API
   review's guide finding.
2. examples/message-board/app/REFERENCE.md around line 34 omits generated/
   from the bootstrap output path. Both generated artifacts use that directory.

Changed Server and Proto Tools references otherwise match local bootstrap,
renamed metadata and explicit class selection. M06 transitive discovery, M07
App Queries and M14 rebuilt-image validation remain future work.
