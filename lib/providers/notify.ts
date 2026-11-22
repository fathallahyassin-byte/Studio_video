export type NotificationKind = "validation_waiting" | "agent_failed" | "budget_reached";

export type Notification = {
  kind: NotificationKind;
  title: string;
  message: string;
  /** chemin de l'appli vers l'élément à traiter ; le notifier le complète avec APP_URL */
  path: string;
};

/** Alertes vers l'humain (Telegram ou e-mail, choix dans NOTIFY_CHANNEL). */
export type Notifier = {
  notify(notification: Notification): Promise<void>;
};

/** Notifier de développement : écrit l'alerte dans la console. */
export const consoleNotifier: Notifier = {
  async notify(notification) {
    console.info(`[notification:${notification.kind}] ${notification.title} — ${notification.message} (${notification.path})`);
  },
};
