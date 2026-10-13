# Recovery configuration scan

Accepted read-only scan by existing orchestrator function /root/mechanical_setup, explicit immutable gpt-6-luna/medium, runtime metadata unavailable. No files edited or tests run by the scanner.

The default is 10 seconds in packages/server/src/delivery/delivery-supervisor.ts (around309–315), matching option TSDoc (772–780). RuntimeDeliverySupervisorGroup in packages/server/src/server/environment-delivery-worker.ts541–545 is the framework construction site; it omits recoveryMs and inherits the default. No example sets a recovery override. The delivery-client multi-machine test fixture uses an intentional 100 ms override. Other explicit settings are tests.

Distinct timers remain: DeliveryClient 30-second request/setup timeouts (client.ts232,556,598); supervisor 30-second watch maximum backoff and close grace; shard registry 30-second lease; client subscription 30-second total retry budget; supervisor stale session threshold 60 seconds. They must not be mechanically replaced by the recovery interval.

The read-only investigation copy of AppFactory template does not construct DeliverySupervisor or override recoveryMs. Its sources/appfactory-template/test-support/hosted-delivery.ts29–41 still describes a 30-second recovery scan and derives a 90-second seed budget; hosted-delivery.test.ts21–29 asserts that budget. The hosted skill around164–166,182–183 and .appfactory/template.json176 repeat those measured budget descriptions. Record for separate template migration: update recovery term, derived budget, tests, generated statement and skill together. This task does not edit the reference folder or perform the template migration.
