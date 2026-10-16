# NO AI

Task completed using ZERO AI. Only `tests/queue.test.ts` and this file was copied/edited/formatted by AI.
Changed files: `Queue.ts`, `Worker.ts`, `main.ts`, and a new `tests/queue.test.ts`.

# Queue implementation

## The problem

`main.ts` enqueues a `SET 50` plus adds for each item, then several workers call `Database.set` in parallel.

`set` reads the current value, sleeps 0–100ms, then writes. If two workers run the same key at once, both read the same number and the last write wins. Per-key order can also break: an `ADD` may start before `SET 50` has written, so later math uses the wrong base.

Expected result is `95` per item with an empty queue. A global lock would get that number but would serialize all workers, which the task rejects.

## Queue (`Queue.ts`)

Messages stay in `messages` until they are confirmed (or dropped after too many failures). `lockedMessagesMap` maps each key currently being processed to its lock entry: `{ messageId, workerId }`.

**Enqueue** — `push` onto `messages` (FIFO) and wake waiting workers.

**Dequeue** — `getFirstUnlockMessageIndex()` returns the first message whose key is not in `lockedMessagesMap`. That message stays in the array; a lock entry for its key (message id + worker id) is stored and the message is returned. If the list is empty, or every leftover key is locked, it returns `undefined`.

**Confirm** — returns `false` and changes nothing if:

- the id is unknown (`findIndex` returns `-1`; the old `splice(-1, 1)` would have deleted the last message),
- the message's key has no lock entry (it was never dequeued),
- the lock entry belongs to a different message or a different worker.

Otherwise it `splice`s the message out of `messages`, deletes the lock entry, clears its failure count, wakes waiting workers and returns `true`. The next message for that key can then be dequeued.

**Fail** — called by a worker when processing threw. Same ownership checks as `Confirm`. The lock is released and the message keeps its position, so it is retried before later messages of the same key. After `MAX_ATTEMPTS` (3) failures the message is dropped so the rest of the queue can proceed. Waiting workers are woken either way.

**WaitForAvailable** — returns a promise that resolves on the next `Enqueue`, `Confirm` or `Fail`, i.e. when a message may have become available.

**Size** — `messages.length` (includes in-flight messages, since they are not removed on dequeue).

So one key is never handled by two workers at the same time, and messages for the same key are processed in enqueue order. Different keys can be in flight together, so workers still run in parallel (up to the number of distinct keys).

## Worker (`Worker.ts`)

- If `Dequeue` returns `undefined`: exit when `Size()` is `0` (queue really empty); otherwise all remaining keys are locked by other workers, so `await WaitForAvailable()` and try again. Workers no longer exit early while work remains.
- Processing is wrapped in `try/catch`: success → `Confirm`, error → log and `Fail`. A failing message no longer crashes the worker or leaves its key locked forever.

## Completion (`main.ts`)

The fixed `sleep(10000)` is replaced by `Promise.all` over the workers' `Work()` promises, so the result is printed as soon as the work is done (~1s instead of 10s). A 10s timeout (`withTimeout`, which clears its timer so the process can exit) is kept as an upper bound in case an operation never resolves. Output format is unchanged.

## Tests (`tests/queue.test.ts`)

Run with Node 22.18+ (runs TypeScript directly, nothing to install):

```bash
node --test tests/queue.test.ts
```

| Test | What it proves |
|---|---|
| Same-key updates | Concurrent workers never corrupt a shared key (every key ends at `95`) |
| Different-key parallelism | A slow key does not block other keys |
| Invalid confirmation | An unknown id does not change the queue |
| Lock ownership | A worker cannot confirm another worker's message, or one not dequeued yet |
| Ordering | Messages of the same key are processed in enqueue order |
| Failure recovery | A failing message is retried, then dropped after 3 attempts; a flaky one succeeds on retry |
| Worker availability | A worker waits instead of exiting while keys are locked, and picks up new work |
| Completion (×2) | Workers finish on their own; `main.ts` exits in under 5s with the correct output |

The tests were checked by injecting 15 bugs one at a time (e.g. ignoring locks in `Dequeue`, skipping the `workerId` check, no `try/catch` in the worker, going back to the fixed sleep). Every bug made the suite fail; 7 of them make it hang instead of failing with a test name, because the queue stops making progress.

## What I would change next

- Make every bug fail with a test name instead of hanging: run with `--test-timeout` and let test callbacks yield to the event loop.
- Retries assume a failed operation wrote nothing (true for `Database.set`, which writes last). With a real database, `ADD` is not idempotent, so a retry after a partial write could apply it twice — it would need an idempotency key per message.
- Dropping a message after `MAX_ATTEMPTS` leaves its key with a wrong value. Keep a dead-letter list and/or stop that key's remaining messages, depending on business rules.
- For large queues, keep one FIFO per key plus a list of ready keys instead of scanning the whole array in `Dequeue`, `Confirm` and `Fail`. Not needed at this size.
- Basic metrics (queue depth, in-flight, retries, dropped messages, processing time).
- Serialize read–modify–write inside `Database.set` per key, so correctness does not depend only on the queue.
- `getRandomIntInRange(3, 6)` never returns `6` (upper bound is exclusive).
- The enqueue loop adds `0..9`; the README says `1..9`. Same total (`95`) because `+ 0` is a no-op.
