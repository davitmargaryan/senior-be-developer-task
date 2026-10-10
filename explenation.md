# NO AI

Task completed using ZERO AI. Only this text was copy-edited by AI.
Changed only `Queue.ts` (other files were only formatted).

# Queue implementation

## The problem

`main.ts` enqueues a `SET 50` plus adds for each item, then several workers call `Database.set` in parallel.

`set` reads the current value, sleeps 0–100ms, then writes. If two workers run the same key at once, both read the same number and the last write wins. Per-key order can also break: an `ADD` may start before `SET 50` has written, so later math uses the wrong base.

Expected result is `95` per item with an empty queue. A global lock would get that number but would serialize all workers, which the task rejects.

## Implementation (`Queue.ts`)

Messages stay in `messages` until `Confirm`. `lockedMessageKeys` is the set of keys currently being processed.

**Enqueue** — `push` onto `messages` (FIFO).

**Dequeue** — `getFirstUnlockMessageIndex()` returns the first message whose key is not in `lockedMessageKeys` (or index `0` if nothing is locked). That message stays in the array; its key is `push`ed onto `lockedMessageKeys` and the message is returned. If the list is empty, or every leftover key is locked, it returns `undefined`.

**Confirm** — finds the message by `id`, `splice`s it out of `messages`, and removes its key from `lockedMessageKeys`. The next message for that key can then be dequeued.

**Size** — `messages.length` (includes in-flight messages, since they are not removed on dequeue).

So one key is never handled by two workers at the same time. Different keys can be in flight together, so workers still run in parallel.

Workers stop when `Dequeue` returns `undefined`. Extra workers may exit while some keys are locked; workers that hold a lock continue after `Confirm` and finish the rest. Parallelism is up to the number of distinct keys.

## What I would change if other files were allowed

- Wait for workers with `Promise.all` instead of a fixed `sleep` in `main.ts`.
- Don’t exit a worker when the queue still has locked messages; wait until `Confirm` frees a key (or until the queue is actually empty).
- Serialize read–modify–write inside `Database.set` per key, so correctness does not depend only on the queue.
- `getRandomIntInRange(3, 6)` never returns `6` (upper bound is exclusive).
- The enqueue loop adds `0..9`; the README says `1..9`. Same total (`95`) because `+ 0` is a no-op.
- Guard `Confirm` when `findIndex` is `-1`. `splice(-1, 1)` would delete the last message.
