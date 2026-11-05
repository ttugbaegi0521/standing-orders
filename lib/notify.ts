export interface Notification {
  userId: string;
  subject: string;
  body: string;
  link?: string;
}

export interface Notifier {
  send(notification: Notification): Promise<void>;
}

// TODO(Mon): real email/push for tier-2 approval links. Logs for now.
export const consoleNotifier: Notifier = {
  async send(n) {
    console.log(`[notify ${n.userId}] ${n.subject}\n${n.body}${n.link ? `\n${n.link}` : ""}`);
  },
};
