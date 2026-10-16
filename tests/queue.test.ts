// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { Database, Message, Operations } from "../Database.ts";
import { Queue } from "../Queue.ts";
import { Worker } from "../Worker.ts";
import { range, sleep } from "../Util.ts";

type Callback = (message: Message) => Promise<void>;

const runWorkers = (queue: Queue, count: number, callback: Callback) =>
  Promise.all(range(count).map((i) => new Worker(i, queue).Work(callback)));

// Same messages as main.ts: SET 50, then ADD 0..9 for every key
const fillQueue = (queue: Queue, keys: string[]) => {
  for (const key of keys) queue.Enqueue(new Message(key, Operations.SET, 50));
  for (let i = 0; i < 10; i++) {
    for (const key of keys) queue.Enqueue(new Message(key, Operations.ADD, i));
  }
};

test("same-key updates: concurrent workers do not corrupt shared keys", async () => {
  const queue = new Queue();
  const db = new Database();
  fillQueue(queue, ["a", "b", "c"]);

  await runWorkers(queue, 5, db.set);

  assert.deepEqual(db.state(), { a: 95, b: 95, c: 95 });
  assert.equal(queue.Size(), 0);
});

test("different-key parallelism: a slow key does not block other keys", async () => {
  const queue = new Queue();
  queue.Enqueue(new Message("a", Operations.ADD, 1));
  for (let i = 0; i < 5; i++)
    queue.Enqueue(new Message("b", Operations.ADD, i));

  let slowFinishedAt = 0;
  const fastFinishedAt: number[] = [];

  await runWorkers(queue, 2, async (message) => {
    if (message.key === "a") {
      await sleep(300);
      slowFinishedAt = performance.now();
    } else {
      await sleep(10);
      fastFinishedAt.push(performance.now());
    }
  });

  assert.equal(fastFinishedAt.length, 5);
  assert.ok(Math.max(...fastFinishedAt) < slowFinishedAt);
});

test("invalid confirmation: unknown id does not change the queue", () => {
  const queue = new Queue();
  const messages = range(3).map(
    (i) => new Message(`key${i}`, Operations.ADD, i),
  );
  messages.forEach(queue.Enqueue);

  assert.equal(queue.Confirm(0, "unknown"), false);
  assert.equal(queue.Fail(0, "unknown"), false);
  assert.equal(queue.Size(), 3);
  assert.equal(queue.Dequeue(0), messages[0]);
});

test("lock ownership: a worker cannot confirm another worker's message", () => {
  const queue = new Queue();
  const first = new Message("a", Operations.ADD, 1);
  const second = new Message("a", Operations.ADD, 2);
  queue.Enqueue(first);
  queue.Enqueue(second);

  assert.equal(queue.Dequeue(0), first);
  assert.equal(queue.Confirm(1, first.id), false); // another worker
  assert.equal(queue.Confirm(0, second.id), false); // not dequeued yet
  assert.equal(queue.Size(), 2);

  assert.equal(queue.Confirm(0, first.id), true);
  assert.equal(queue.Size(), 1);
});

test("ordering: messages of the same key are processed in enqueue order", async () => {
  const queue = new Queue();
  for (let i = 0; i < 10; i++) {
    queue.Enqueue(new Message("a", Operations.ADD, i));
    queue.Enqueue(new Message("b", Operations.ADD, i));
  }

  const processed: Record<string, number[]> = { a: [], b: [] };

  await runWorkers(queue, 4, async (message) => {
    await sleep(Math.random() * 20);
    processed[message.key].push(message.val);
  });

  assert.deepEqual(processed.a, range(10));
  assert.deepEqual(processed.b, range(10));
});

test("failure recovery: failed messages are retried, then dropped", async (t) => {
  t.mock.method(console, "error", () => {});

  const queue = new Queue();
  const db = new Database();
  fillQueue(queue, ["a", "b"]);

  let alwaysFailingCalls = 0;
  let flakyCalls = 0;

  await runWorkers(queue, 4, async (message) => {
    if (message.key === "a" && message.val === 5) {
      alwaysFailingCalls++;
      throw new Error("always fails");
    }
    if (message.key === "b" && message.val === 3 && ++flakyCalls <= 2) {
      throw new Error("flaky");
    }
    await db.set(message);
  });

  assert.equal(alwaysFailingCalls, 3); // MAX_ATTEMPTS, then dropped
  assert.equal(flakyCalls, 3); // 2 failures + 1 success
  assert.equal(queue.Size(), 0);
  assert.deepEqual(db.state(), { a: 90, b: 95 });
});

test("worker availability: a worker waits instead of exiting while keys are locked", async () => {
  const queue = new Queue();
  queue.Enqueue(new Message("a", Operations.ADD, 1));

  const events: string[] = [];
  const workers = range(2).map((workerId) =>
    new Worker(workerId, queue).Work(async (message) => {
      if (message.key === "a") await sleep(200);
      events.push(`${message.key} done by worker ${workerId}`);
    }),
  );

  // Worker 1 found nothing to do; a new key arrives while "a" is still locked
  await sleep(50);
  queue.Enqueue(new Message("b", Operations.ADD, 1));

  await Promise.all(workers);

  assert.deepEqual(events, ["b done by worker 1", "a done by worker 0"]);
  assert.equal(queue.Size(), 0);
});

test("completion: workers finish on their own when the queue is drained", async () => {
  const queue = new Queue();
  fillQueue(queue, ["a", "b", "c"]);

  await runWorkers(queue, 3, async () => {});

  assert.equal(queue.Size(), 0);
});

test("completion: main.ts exits when work is done, without the fixed 10s sleep", async () => {
  const start = performance.now();
  const { stdout } = await promisify(execFile)(process.execPath, ["main.ts"], {
    cwd: join(import.meta.dirname, ".."),
    // Plain output even if the terminal forces colors, so it can be matched
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 5000, `took ${elapsed} ms`);
  assert.match(stdout, /Queue size: {2}0/);

  const state = JSON.parse(stdout.slice(stdout.indexOf("{")));
  for (const value of Object.values(state)) assert.equal(value, 95);
});
