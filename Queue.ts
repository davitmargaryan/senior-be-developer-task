import { Message } from "./Database.ts";

export class Queue {
  private messages: Message[];

  private lockedMessageKeys: string[];

  start: number;

  constructor() {
    this.messages = [];
    this.lockedMessageKeys = [];
    this.start = performance.now();
  }

  getFirstUnlockMessageIndex(): number {
    return this.messages.findIndex(
      (message) =>
        !this.lockedMessageKeys.length ||
        !this.lockedMessageKeys.includes(message.key),
    );
  }

  Enqueue = (message: Message) => {
    this.messages.push(message);
  };

  Dequeue = (workerId: number): Message | undefined => {
    if (!this.messages.length) return undefined;
    const firstUnlockedMessageIndex = this.getFirstUnlockMessageIndex();
    if (firstUnlockedMessageIndex === -1) {
      return undefined;
    }
    const messageToLock = this.messages[firstUnlockedMessageIndex];
    this.lockedMessageKeys.push(messageToLock.key);
    return messageToLock;
  };

  Confirm = (workerId: number, messageId: string) => {
    const mesInd = this.messages.findIndex((a) => a.id === messageId);
    const mess = this.messages.splice(mesInd, 1)[0];
    this.lockedMessageKeys = this.lockedMessageKeys.filter(
      (k) => k !== mess?.key,
    );
    if (!this.messages.length) {
      const end = performance.now();

      console.log(`Execution time: ${end - this.start} ms`);
    }
  };

  Size = () => {
    return this.messages.length;
  };
}
