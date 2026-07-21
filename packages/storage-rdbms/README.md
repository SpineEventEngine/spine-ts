# `@spine-ts/storage-rdbms`

This private workspace package is the MySQL-first implementation of the
provider-neutral `@spine-ts/storage` factory seam. Packet 1 provides validated,
asynchronous factory initialization, an owned pool, and verification of two
private InnoDB tables. Record operations arrive in later T-0051 packets; do not
use this package for application persistence yet.

`MysqlStorageFactory.create()` accepts a complete MySQL URL and returns only
after it has connected and verified its fixed private schema. The public root
deliberately does not expose mysql2 pools, SQL, a dialect API, codecs, or test
helpers. Closing the factory closes every issued storage handle and its owned
pool; repeated calls return the same completion promise.

For an explicit disposable database, run the opt-in real-MySQL proof:

```sh
SPINE_TS_MYSQL_URL=mysql://user:password@127.0.0.1:3306/spine_test \
  pnpm --filter @spine-ts/storage-rdbms test:mysql
```

The command never discovers Docker or starts a container. It requires the URL,
creates only `spine_ts_records` and `spine_ts_columns`, and removes those two
tables after the test. Keep credentials out of shell history and logs.
