import { Database, Operations, Message } from "./Database.ts";
import { Queue } from "./Queue.ts";
import { range, sleep, getRandomIntInRange } from "./Util.ts";
import { Worker } from "./Worker.ts";

const ITEMS_NUMBER = getRandomIntInRange(3, 6);
const WORKERS_NUMBER = getRandomIntInRange(3, 6);

const ITEMS = range(ITEMS_NUMBER).map((item) => `item${item}`);
console.log("ITEMS: ", ITEMS);

const applyToAll = (queue: Queue, operation: Operations, val: number): void => {
  for (const product of ITEMS) {
    queue.Enqueue(new Message(product, operation, val));
  }
};

const withTimeout = async (promise: Promise<unknown>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise((resolve) => (timer = setTimeout(resolve, ms)));
  await Promise.race([promise, timeout]);
  clearTimeout(timer);
};

const main = async () => {
  console.log(`Number of items:${ITEMS_NUMBER}`);
  console.log(`Number of workers:${WORKERS_NUMBER}`);
  const db = new Database();
  const queue = new Queue();

  applyToAll(queue, Operations.SET, 50);

  for (let i = 0; i < 10; i++) {
    applyToAll(queue, Operations.ADD, i);
  }

  const workers = range(WORKERS_NUMBER).map((i) =>
    new Worker(i, queue).Work(db.set),
  );
  await withTimeout(Promise.all(workers), 10000);

  console.log("Queue size: ", queue.Size());
  console.log("DB state:\n", JSON.stringify(db.state(), null, 4));
};
main();
