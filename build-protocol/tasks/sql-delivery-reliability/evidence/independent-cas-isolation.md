# Live CAS isolation finding

The first parallel semantic-equivalent wire-encoding CAS run failed only where two Vitest invocations shared one database endpoint: MySQL/InnoDB beside MyISAM, and MariaDB/InnoDB beside Aria. The old test named both context and storage group with `Date.now()`, so simultaneous invocations could select and alter one physical table. The initial logs were overwritten by the isolated reruns; the observed failure summary from that tool result is retained here:

| Initial simultaneous run | Exit  | Observed present-CAS assertion                |
| ------------------------ | ----- | --------------------------------------------- |
| PostgreSQL 16 / 18       | 0 / 0 | Exactly one successful claim                  |
| MySQL InnoDB             | 0     | Exactly one successful claim                  |
| MariaDB InnoDB           | 1     | `[true, true]` where one success was expected |
| MyISAM                   | 1     | `[]` successful claims where one was expected |
| Aria                     | 1     | `[]` successful claims where one was expected |

The test now uses one UUID-derived context/group per invocation. Sequential runs on each shared endpoint passed one active competing-CAS test each. Read-only catalog inspection after those runs confirmed distinct physical tables and engines:

| Endpoint     | Physical table                                           | Engine |
| ------------ | -------------------------------------------------------- | ------ |
| MySQL 8.4    | `t0134_cas_fe8c83c079464ae19db7ac6ec7dd7624_StringValue` | InnoDB |
| MySQL 8.4    | `t0134_cas_5d0e7b2e9aa941d4a5949a8feff9e04f_StringValue` | MyISAM |
| MariaDB 11.4 | `t0134_cas_97eb75234eee4f059965cfb7e075d796_StringValue` | InnoDB |
| MariaDB 11.4 | `t0134_cas_81e76eb5518546e89985ac8025708e83_StringValue` | Aria   |

PostgreSQL 16/18 had separate endpoints and passed their semantic-equivalent wire-encoding CAS runs. A second simultaneous run of the four MySQL-family variants with UUID isolation passed all four (one active test each); `independent-cas-parallel-*.log` retains exact output. No production CAS change was made in response to the interfering test run.
