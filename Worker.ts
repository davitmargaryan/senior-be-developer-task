import { Message } from "./Database.ts";
import { Queue } from "./Queue.ts";

export class Worker {
  private queue: Queue;
  private workerId: number;

  constructor(workerId: number, queue: Queue) {
    this.queue = queue;
    this.workerId = workerId;
  }

  Work = async (
    callback: (message: Message) => Promise<void>,
  ): Promise<void> => {
    while (true) {
      const message = this.queue.Dequeue(this.workerId);
      if (!message) {
        if (!this.queue.Size()) break;

        await this.queue.WaitForAvailable();
        continue;
      }
      try {
        await callback(message);
        this.queue.Confirm(this.workerId, message.id);
      } catch (error) {
        console.error(
          `Worker with id - ${this.workerId} failed message with id - ${message.id}:`,
          error,
        );
        this.queue.Fail(this.workerId, message.id);
      }
    }
  };
}
