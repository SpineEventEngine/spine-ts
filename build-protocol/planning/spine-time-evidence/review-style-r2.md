**Scoped findings are resolved.** Compared with `fb616bc60`, the time bypass gate now catches the accepted `bind`/`call`/`apply` clock cases and recognized imported helpers; its regression tests cover those forms while retaining conversion of supplied Date values. The corrected BlackBox event and iterator summaries, and both options-interface summaries, describe their actual behavior or settings.

**Limitations:** This was a read-only re-review. I relied on the recorded focused test and mechanical-check evidence and did not rerun tests. Full release verification remains pending.
