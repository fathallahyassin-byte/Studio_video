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

/** Pour les opérations qui ont déjà prévenu l'humain (runAgent alerte lui-même après 3 échecs). */
export const silentNotifier: Notifier = { async notify() {} };

export function formatNotification(notification: Notification, appUrl: string): string {
  return `${notification.title}\n${notification.message}\n${appUrl.replace(/\/$/, "")}${notification.path}`;
}

export type FetchLike =(url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

/**
 * Telegram (Bot API, sendMessage). Un échec d'envoi est journalisé sans faire échouer l'opération
 * qui l'a déclenché : la vidéo reste visible dans « À valider ».
 */
export function createTelegramNotifier(options: { token: string; chatId: string; appUrl: string; fetchImpl?: FetchLike }): Notifier {
  const send: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    async notify(notification) {
      try {
        const response = await send(`https://api.telegram.org/bot${options.token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: options.chatId, text: formatNotification(notification, options.appUrl), disable_web_page_preview: true }),
        });
        if (!response.ok) console.error(`[notification] Telegram a répondu ${response.status}`);
      } catch (error) {
        console.error("[notification] envoi Telegram impossible", error instanceof Error ? error.message : error);
      }
    },
  };
}

/** Choix du canal d'après .env : Telegram si configuré, sinon la console (l'e-mail viendra plus tard). */
export function getNotifier(env: Record<string, string | undefined> = process.env): Notifier {
  const appUrl = env.APP_URL || "http://localhost:3000";
  if (env.NOTIFY_CHANNEL === "telegram" && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    return createTelegramNotifier({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, appUrl });
  }
  return consoleNotifier;
}
