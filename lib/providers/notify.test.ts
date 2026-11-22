import { describe, expect, it, vi } from "vitest";
import { consoleNotifier, createTelegramNotifier, formatNotification, getNotifier, type FetchLike } from "./notify";

const notification = { kind: "validation_waiting" as const, title: "V2 · Script à valider", message: "Pourquoi les crayons sont jaunes", path: "/validations?item=abc" };

describe("notifications", () => {
  it("contiennent un lien direct vers l'élément à valider", () => {
    expect(formatNotification(notification, "https://studio.example.test/")).toBe(
      "V2 · Script à valider\nPourquoi les crayons sont jaunes\nhttps://studio.example.test/validations?item=abc",
    );
  });

  it("partent sur Telegram avec le bon chat", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({ ok: true, status: 200 }));
    await createTelegramNotifier({ token: "TOKEN", chatId: "42", appUrl: "https://studio.example.test", fetchImpl }).notify(notification);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.telegram.org/botTOKEN/sendMessage", expect.objectContaining({ method: "POST" }));
    const body: unknown = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body).toMatchObject({ chat_id: "42", text: expect.stringContaining("/validations?item=abc") });
  });

  it("ne font pas échouer l'opération si Telegram ne répond pas", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error("réseau coupé");
    });
    await expect(createTelegramNotifier({ token: "T", chatId: "1", appUrl: "x", fetchImpl }).notify(notification)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("utilisent la console tant que Telegram n'est pas configuré", () => {
    expect(getNotifier({ NOTIFY_CHANNEL: "telegram", TELEGRAM_BOT_TOKEN: "" })).toBe(consoleNotifier);
    expect(getNotifier({ NOTIFY_CHANNEL: "telegram", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" })).not.toBe(consoleNotifier);
  });
});
