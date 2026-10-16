import { Message } from "./Database.ts";

type LockedMessage = { messageId: string; workerId: number };

const MAX_ATTEMPTS = 3;

export class Queue {
  private messages: Message[];

  private lockedMessagesMap: Map<string, LockedMessage>;

  private waiters: (() => void)[];

  private failedAttemptsMap: Map<string, number>;

  constructor() {
    this.messages = [];
    this.lockedMessagesMap = new Map();
    this.waiters = [];
    this.failedAttemptsMap = new Map();
  }

  private notifyWaiters() {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }

  private getLockedMessageIndex(workerId: number, messageId: string): number {
    const index = this.messages.findIndex((m) => m.id === messageId);

    if (index === -1) return -1;

    const lockedMessage = this.lockedMessagesMap.get(this.messages[index].key);

    if (
      !lockedMessage ||
      lockedMessage.messageId !== messageId ||
      lockedMessage.workerId !== workerId
    ) {
      return -1;
    }

    return index;
  }

  getFirstUnlockMessageIndex(): number {
    return this.messages.findIndex(
      (message) => !this.lockedMessagesMap.has(message.key),
    );
  }

  Enqueue = (message: Message) => {
    this.messages.push(message);
    this.notifyWaiters();
  };

  Dequeue = (workerId: number): Message | undefined => {
    const firstUnlockedMessageIndex = this.getFirstUnlockMessageIndex();
    if (firstUnlockedMessageIndex === -1) {
      return undefined;
    }
    const messageToLock = this.messages[firstUnlockedMessageIndex];
    this.lockedMessagesMap.set(messageToLock.key, {
      messageId: messageToLock.id,
      workerId,
    });
    return messageToLock;
  };

  Confirm = (workerId: number, messageId: string) => {
    const index = this.getLockedMessageIndex(workerId, messageId);

    if (index === -1) return false;

    const [message] = this.messages.splice(index, 1);
    this.lockedMessagesMap.delete(message.key);
    this.failedAttemptsMap.delete(messageId);
    this.notifyWaiters();

    return true;
  };

  Fail = (workerId: number, messageId: string) => {
    const index = this.getLockedMessageIndex(workerId, messageId);

    if (index === -1) return false;

    const message = this.messages[index];
    const attempts = (this.failedAttemptsMap.get(messageId) ?? 0) + 1;

    if (attempts >= MAX_ATTEMPTS) {
      this.messages.splice(index, 1);
      this.failedAttemptsMap.delete(messageId);
    } else {
      this.failedAttemptsMap.set(messageId, attempts);
    }

    this.lockedMessagesMap.delete(message.key);
    this.notifyWaiters();

    return true;
  };

  WaitForAvailable = (): Promise<void> => {
    return new Promise((resolve) => this.waiters.push(resolve));
  };

  Size = () => {
    return this.messages.length;
  };
}
