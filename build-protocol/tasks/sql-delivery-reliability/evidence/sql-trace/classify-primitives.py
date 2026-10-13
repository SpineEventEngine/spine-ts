"""Classify only marked, warmed primitive SQL intervals in task capture evidence."""
import json
import re
from pathlib import Path

base = Path(__file__).resolve().parent
operations = ["record-read", "record-write", "record-delete", "record-query", "record-batch", "record-cas"]
results = []
for engine in ["postgres16", "postgres18", "mysql84", "mariadb114"]:
    for operation in operations:
        candidates = sorted((base / "runs").glob(f"{engine}-{operation}-*.json"))
        assert candidates, (engine, operation, "missing capture")
        path = candidates[-1]
        meta = json.loads(path.read_text())
        assert meta["exitCode"] == 0 and meta["loggingRestored"], meta
        assert not meta["failures"] and not meta["restoreErrors"], meta
        lines = Path(meta["rawLog"]).read_text().splitlines()
        statements = []
        for line in lines:
            if engine.startswith("postgres"):
                match = re.search(r"LOG:  (?:statement|execute [^:]+): (.*)", line)
                if match:
                    statements.append(match.group(1))
            else:
                item = json.loads(line)
                if item["command_type"] in ["Query", "Execute"]:
                    statements.append(item["argument"])
        suffix = operation.replace("-", "_")
        begins = [i for i, sql in enumerate(statements) if f"spine_trace_begin_{suffix}" in sql]
        ends = [i for i, sql in enumerate(statements) if f"spine_trace_end_{suffix}" in sql]
        assert len(begins) == len(ends) == 1 and begins[0] < ends[0], (path, begins, ends)
        measured = statements[begins[0] + 1:ends[0]]
        assert measured, (path, "empty measurement")
        forbidden = [sql for sql in measured if re.search(r"\b(?:BEGIN|COMMIT|ROLLBACK|START TRANSACTION|FOR UPDATE|FOR SHARE|GET_LOCK|RELEASE_LOCK|pg_advisory|CREATE|ALTER|DROP)\b", sql, re.I) or "pg_advisory" in sql]
        assert not forbidden, (path, forbidden)
        if operation == "record-cas":
            updates = [sql for sql in measured if sql.startswith("UPDATE ")]
            assert len(updates) == 1, (path, updates)
            assert re.search(r"WHERE.*ID.*AND.*bytes", updates[0], re.I), (path, updates)
        results.append({"engine": engine, "operation": operation, "metadata": str(path.relative_to(base)), "statementCount": len(measured), "forbiddenStatements": len(forbidden), "statements": measured})
(base / "primitive-sql-classification.json").write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps({"verifiedCases": len(results), "forbiddenStatements": sum(row["forbiddenStatements"] for row in results)}))
