# Recovery configuration scan

Accepted read-only scan by existing orchestrator function /root/mechanical_setup, explicit immutable gpt-6-luna/medium, runtime metadata unavailable. No files edited or tests run by the scanner.

The default is 10 seconds in packages/server/src/delivery/delivery-supervisor.ts (around309–315), matching option TSDoc (772–780). RuntimeDeliverySupervisorGroup in packages/server/src/server/environment-delivery-worker.ts541–545 is the framework construction site; it omits recoveryMs and inherits the default. No example sets a recovery override. The delivery-client multi-machine test fixture uses an intentional 100 ms override. Other explicit settings are tests.

Distinct timers remain: DeliveryClient 30-second request/setup timeouts (client.ts232,556,598); supervisor 30-second watch maximum backoff and close grace; shard registry 30-second lease; client subscription 30-second total retry budget; supervisor stale session threshold 60 seconds. They must not be mechanically replaced by the recovery interval.

The read-only investigation copy of AppFactory template does not construct DeliverySupervisor or override recoveryMs. Its sources/appfactory-template/test-support/hosted-delivery.ts29–41 still describes a 30-second recovery scan and derives a 90-second seed budget; hosted-delivery.test.ts21–29 asserts that budget. The hosted skill around164–166,182–183 and .appfactory/template.json176 repeat those measured budget descriptions. Record for separate template migration: update recovery term, derived budget, tests, generated statement and skill together. This task does not edit the reference folder or perform the template migration.

## Post-release pending-work assessment preparation

Parent source inspection finds JVM core-jvm/server/src/main/java/io/spine/server/delivery/Delivery.java reads newestMessageToDeliver and emits onNewMessage after releasing the shard (lines487–488). Current TS DeliveryDrain.run releases and returns its finite result; LocalDeliverySource has no cross-process observation stream. Thus a SQL arrival after the last empty read can still wait for periodic recovery when its local notification loses the busy-shard race. The pending live timing slice must force arrivals both before and after release and measure the actual recovery delay. A naive unconditional notification of every retained pending row would reintroduce the reviewed failure-feedback retry loop. Assess a bounded successful-drain-only follow-up or retain the documented fallback with concrete measured limits; do not add an unconditional loop or claim a ten-second deadline. This is source analysis, not passing live evidence or a decided runtime change.

Further bounded parent source note: DeliveryDrain.#readPages already repeats a
full scan after delivered progress, then releases after an empty/no-progress
scan. The remaining race is specifically between that final observation and
release, not every paginated pass. An assessment should gate any immediate
post-release follow-up on a successful healthy drain and prove failed retained
rows cannot recreate the previously fixed feedback loop. Current public local
Inbox port has no newestPending method; the similarly named RPC helper exists
only on DeliveryClient. Do not add a public storage port solely by copying the
remote method name. Prefer measuring the exact existing race and selecting the
smallest supported follow-up seam if justified; otherwise document the measured
fallback explicitly. No runtime change is decided by this note.

## Remaining live acceptance boundary

The first-task specification explicitly requests a cross-process late-write case. A single-process public supervisor/SQL component fixture can establish default and override timing, but does not replace that case. Use a separate writer process with coordinated persistence and failed busy-shard claim to prove the before-release arrival; separately gate an after-release arrival and missed notification. The previously accepted process workload is not evidence of this deterministic race. Preserve this distinction when implementing the remaining timing tests.

The live clock slice must also retain a shared Delivery server across actual
application-worker death/replacement while accepted work is pending. Measure
recovery under the default 60-second stale-session threshold separately from
the 10-second scan and configurable server processing timeout. The current
crash matrix covers database-only processing faults and shared server volatility;
neither its graceful baseline restart nor its destroyed/recreated Delivery server
proves retained-server stale-session takeover. Use exact pending Inbox IDs, old
and new process IDs, handler entries, configured values, and elapsed observations.
Do not advertise a hard ten-second bound. This completes an existing specification
requirement (first-task lines 536–542), not a new persistence subsystem.
