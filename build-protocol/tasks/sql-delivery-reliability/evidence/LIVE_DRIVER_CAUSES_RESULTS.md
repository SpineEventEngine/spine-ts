# Live SQL driver cause evidence

The built adapter probe live-driver-causes.mjs passed on all four dedicated SQL servers. Raw output is live-driver-causes.log, process 32405, Node24.18.0. Unique per-provider tables and insert-failure triggers produced real driver errors: PostgreSQL P0001 on 16.15/18.6; MySQL/MariaDB ER_SIGNAL_EXCEPTION with errno 1644 on 8.4.10/11.4.13.

The original driver Error remains reachable as the normalized error cause, including injected diagnostic text and code. The outer provider message stays PostgreSQL/MySQL record operation failed and excludes the diagnostic marker. The failed write leaves no row; after removing the trigger, retry succeeds. Triggers, PostgreSQL functions, and tables are removed in finally. The probe has a 60-second process bound and uses generic StringValue record fixtures for generic storage writes, not domain message substitutions.

This proves adapter-level retained causes on live drivers. It does not prove the entire command-service logger/Ack boundary, SQL schema/acknowledgement faults, or automatic retry of every database failure. The normal provider cause tests and service safe-Ack tests remain the regression coverage. No production source was changed for the probe.
