# SQL trace wrapper functional checks

These checks exercise evidence tooling only. They do not establish framework SQL acceptance.
The implementation agent reserved a SQL-idle window; only the four recorded task containers were used.

Success probes captured the marker query on PostgreSQL 16 and MySQL 8.4. Failure probes
on PostgreSQL 16 and MariaDB returned the deliberate child exit code 7 and restored logging.
The first MySQL success trace encoded `argument` as a Buffer and decoded timestamps in local
time. The capture query now returns SQL text and a UTC timestamp string; the corrected trace
contains the readable marker and correct UTC time. The original trace is retained.

The first 90-second forced-timeout probes exposed an evidence-tool bug: the escalation timer
could fire before the child's exit callback installed its promise resolver. PostgreSQL's wrapper
exited 13 with an unsettled-top-level-await warning; MySQL's wrapper remained alive with its
connection. Neither reached its restoration `finally`. The PostgreSQL 18 role/database overrides
were reset for the three task databases; MySQL general logging was turned off and its dedicated
container's original FILE output restored. The exact stuck MySQL wrapper PID 48557 was confirmed
by its task-specific command and terminated; no other process was stopped.

The fix creates the escalation promise before termination can occur. This failure invalidates
the initial timeout runs; they produced no metadata
files. Their terminal output is summarized here rather than treated as successful capture.

Targeted ESLint, Prettier and node syntax checks passed after correction. A probe formatting
failure was fixed before that passing check.

Corrected forced-timeout checks passed on PostgreSQL 18 and MySQL 8.4: both deliberately ignored
SIGTERM, were killed after the 90-second bound plus two-second grace, returned exit 128, and
produced metadata with `loggingRestored: true` and no capture/restoration errors. Measured windows
were 92,005 ms and 92,006 ms. Exact probe PIDs 61970 and 62031 no longer existed after completion.
Independent driver queries confirmed no PostgreSQL role/database `log_statement` overrides on
either server and `general_log=0`, `log_output=FILE` on both MySQL-family servers. See
`restoration-check.json` and the paired `runs/*-wrapper-timeout-fixed-*` files.

The SQL-idle window was then released to implementation. Capturing and classifying actual
framework operations remains pending.
