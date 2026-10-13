"""Classify schema initialization separately from measured storage data operations."""
import json
import re
from pathlib import Path

base = Path(__file__).resolve().parent
results = []
for engine in ["postgres16", "postgres18", "mysql84", "mariadb114"]:
    for operation in ["immutable-append", "entity-commit", "history-append-read", "history-maintenance", "inbox-ack", "delivered-cleanup"]:
        path = sorted((base / "runs").glob(f"{engine}-{operation}-*.json"))[-1]
        meta = json.loads(path.read_text())
        assert meta["exitCode"] == 0 and meta["loggingRestored"] and not meta["failures"] and not meta["restoreErrors"], meta
        statements = []
        for line in Path(meta["rawLog"]).read_text().splitlines():
            if engine.startswith("postgres"):
                match = re.search(r"UTC \[(\d+)\] LOG:  (?:statement|execute [^:]+): (.*)", line)
                if match:
                    statements.append((match[1], match[2]))
            else:
                item = json.loads(line)
                if item["command_type"] in ["Query", "Execute"]:
                    statements.append((str(item["thread_id"]), item["argument"]))
        suffix = operation.replace("-", "_")
        begins = [i for i, (_, sql) in enumerate(statements) if f"spine_trace_begin_{suffix}" in sql]
        ends = [i for i, (_, sql) in enumerate(statements) if f"spine_trace_end_{suffix}" in sql]
        assert len(begins) == len(ends) == 1 and begins[0] < ends[0], (path, begins, ends)
        active, blocks, setup, data = {}, [], [], []
        for connection, sql in statements[begins[0] + 1:ends[0]]:
            if sql == "BEGIN":
                assert connection not in active
                active[connection] = [sql]
            elif connection in active:
                active[connection].append(sql)
                if sql == "COMMIT":
                    block = active.pop(connection)
                    assert any(s.startswith("CREATE TABLE IF NOT EXISTS ") for s in block), block
                    assert all(s in ["BEGIN", "COMMIT"] or s.startswith("CREATE TABLE IF NOT EXISTS ") or s.startswith("SELECT pg_advisory_xact_lock(") or (s.startswith("SELECT ") and ("information_schema." in s or "pg_catalog." in s)) for s in block), block
                    blocks.append({"connection": connection, "statements": block})
            elif sql.startswith("CREATE TABLE IF NOT EXISTS ") or (sql.startswith("SELECT ") and ("information_schema." in sql or "pg_catalog." in sql)):
                setup.append(sql)
            else:
                assert not re.search(r"\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION|FOR UPDATE|FOR SHARE|GET_LOCK|RELEASE_LOCK|ALTER|DROP)\b", sql, re.I) and "pg_advisory" not in sql, sql
                data.append(sql)
        assert not active and data, path
        if operation == "entity-commit":
            inserts = [sql for sql in data if sql.startswith("INSERT INTO ")]
            assert len(inserts) == 4, (path, inserts)
            assert all(f"_{family}" in sql.split("(")[0] for family, sql in zip(["states", "diagnostics", "events", "current"], inserts)), (path, inserts)
        if operation == "delivered-cleanup":
            assert len(data) == 1 and data[0].startswith("DELETE "), (path, data)
            assert "WHERE" in data[0] and "ID" in data[0] and " AND " not in data[0], (path, data)
        if operation == "inbox-ack":
            updates = [sql for sql in data if sql.startswith("UPDATE ")]
            assert len(updates) == 1 and re.search(r"WHERE.*ID.*AND.*bytes", updates[0], re.I), (path, updates)
        results.append({"engine": engine, "operation": operation, "metadata": str(path.relative_to(base)), "initializationTransactions": blocks, "initializationStatementsOutsideTransactions": setup, "independentDataStatements": data})
(base / "storage-sql-classification.json").write_text(json.dumps(results, indent=2) + "\n")
for row in results:
    print(row["engine"], row["operation"], "setupTransactions", len(row["initializationTransactions"]), "otherSetup", len(row["initializationStatementsOutsideTransactions"]), "dataStatements", len(row["independentDataStatements"]))
