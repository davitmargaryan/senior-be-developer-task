import { Message } from "./Database.ts";

type LockedMessage = { messageId: string; workerId: number };

export class Queue {
  private messages: Message[];

  private lockedMessagesMap: Map<string, LockedMessage>;

  constructor() {
    this.messages = [];
    this.lockedMessagesMap = new Map();
  }

  getFirstUnlockMessageIndex(): number {
    return this.messages.findIndex(
      (message) => !this.lockedMessagesMap.has(message.key),
    );
  }

  Enqueue = (message: Message) => {
    this.messages.push(message);
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
    const index = this.messages.findIndex((m) => m.id === messageId);

    if (index === -1) return false;

    const { key } = this.messages[index];
    const lockedMessage = this.lockedMessagesMap.get(key);

    if (
      !lockedMessage ||
      lockedMessage.messageId !== messageId ||
      lockedMessage.workerId !== workerId
    ) {
      return false;
    }

    this.messages.splice(index, 1);
    this.lockedMessagesMap.delete(key);

    return true;
  };

  Size = () => {
    return this.messages.length;
  };
}
