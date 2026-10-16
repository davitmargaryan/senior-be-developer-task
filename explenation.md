# NO AI

Task completed using ZERO AI. Only this text was copy-edited by AI.
Changed only `Queue.ts` (other files were only formatted).

# Queue implementation

## The problem

`main.ts` enqueues a `SET 50` plus adds for each item, then several workers call `Database.set` in parallel.

`set` reads the current value, sleeps 0–100ms, then writes. If two workers run the same key at once, both read the same number and the last write wins. Per-key order can also break: an `ADD` may start before `SET 50` has written, so later math uses the wrong base.

Expected result is `95` per item with an empty queue. A global lock would get that number but would serialize all workers, which the task rejects.

## Implementation (`Queue.ts`)

Messages stay in `messages` until `Confirm`. `lockedMessagesMap` maps each key currently being processed to its lock entry: `{ messageId, workerId }`.

**Enqueue** — `push` onto `messages` (FIFO).

**Dequeue** — `getFirstUnlockMessageIndex()` returns the first message whose key is not in `lockedMessagesMap`. That message stays in the array; a lock entry for its key (message id + worker id) is stored and the message is returned. If the list is empty, or every leftover key is locked, it returns `undefined`.

**Confirm** — finds the message by `id`. It returns `false` and changes nothing if:

- the id is unknown (`findIndex` returns `-1`; the old `splice(-1, 1)` would have deleted the last message),
- the message's key has no lock entry (it was never dequeued),
- the lock entry belongs to a different message or a different worker.

Otherwise it `splice`s the message out of `messages`, deletes the lock entry and returns `true`. The next message for that key can then be dequeued.

**Size** — `messages.length` (includes in-flight messages, since they are not removed on dequeue).

So one key is never handled by two workers at the same time, and messages for the same key are processed in enqueue order. Different keys can be in flight together, so workers still run in parallel.

Workers stop when `Dequeue` returns `undefined`. Extra workers may exit while some keys are locked; workers that hold a lock continue after `Confirm` and finish the rest. Parallelism is up to the number of distinct keys.

## What I would change if other files were allowed

- Wait for workers with `Promise.all` instead of a fixed `sleep` in `main.ts`.
- Don’t exit a worker when the queue still has locked messages; wait until `Confirm` frees a key (or until the queue is actually empty).
- Serialize read–modify–write inside `Database.set` per key, so correctness does not depend only on the queue.
- `getRandomIntInRange(3, 6)` never returns `6` (upper bound is exclusive).
- The enqueue loop adds `0..9`; the README says `1..9`. Same total (`95`) because `+ 0` is a no-op.
