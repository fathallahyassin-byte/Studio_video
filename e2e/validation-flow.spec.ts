import { expect, test, type Page } from "@playwright/test";
import { base32Decode, hotp, totpCounter } from "@/lib/auth/totp";
import { v3Decisions, videoState as stageOf } from "./db";
import { e2eOwner } from "./fixtures";

// Parcours complet sur les données de démo : V1 (idées), V2 (script), V3 (GO), comme le ferait l'humain.

async function queueBadge(page: Page): Promise<string> {
  return (await page.getByRole("link", { name: /À valider/ }).innerText()).replace(/\D+/g, "");
}

test.describe.serial("parcours V1 → V2 → V3", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("connexion avec mot de passe et code TOTP", async () => {
    await page.goto("/production");
    await expect(page).toHaveURL(/\/login\?next=%2Fproduction/);
    await page.getByLabel("E-mail").fill(e2eOwner.email);
    await page.getByLabel("Mot de passe").fill(e2eOwner.password);
    await page.getByLabel("Code de l'application d'authentification").fill(hotp(base32Decode(e2eOwner.totpSecret), totpCounter(Date.now())));
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(/\/production$/);
    await expect(page.getByRole("heading", { name: "Production", level: 1 })).toBeVisible();
    expect(await queueBadge(page)).toBe("5");
  });

  test("V1 : valider une idée la lance chez le recherchiste", async () => {
    await page.goto("/validations?item=v1");
    await page.getByLabel(/Pourquoi les capsules de bière ont 21 dents/).check();
    await page.getByLabel("Note pour l'agent").fill("Insister sur l'étanchéité");
    await page.getByRole("button", { name: "Valider la sélection" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Idées validées" })).toBeVisible();

    expect(await stageOf("Pourquoi les capsules de bière ont 21 dents")).toEqual({ stage: "RESEARCH", agents: [3] });
    await expect(page.getByRole("link", { name: /2 idées à trier/ })).toBeVisible();
  });

  test("V2 : une correction exige une note, puis la validation lance les agents 5 et 6", async () => {
    await page.getByRole("link", { name: /Pourquoi les crayons sont jaunes/ }).click();
    await expect(page.getByRole("heading", { name: "Pourquoi les crayons sont jaunes" })).toBeVisible();
    await page.getByRole("button", { name: "Demander une correction" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "ce que l'agent doit corriger" })).toBeVisible();

    await page.getByRole("button", { name: "Valider", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Script validé" })).toBeVisible();
    expect(await stageOf("Pourquoi les crayons sont jaunes")).toEqual({ stage: "VISUALS_AND_AUDIO", agents: [5, 6] });
  });

  test("V3 : le GO programme la vidéo et lance l'agent publication", async () => {
    await page.getByRole("link", { name: /Le secret du trombone/ }).click();
    await expect(page.getByText("Étiquettes appliquées à la publication")).toBeVisible();
    await page.getByRole("button", { name: "Valider (GO)" }).click();
    await expect(page.getByRole("status").filter({ hasText: "GO donné" })).toBeVisible();
    expect(await stageOf("Le secret du trombone")).toEqual({ stage: "SCHEDULED", agents: [9] });

    expect(await v3Decisions("Le secret du trombone")).toEqual(["APPROVED"]);
  });

  test("le tableau de production reflète les décisions", async () => {
    await page.goto("/production");
    const research = page.getByRole("region", { name: "Recherche" });
    await expect(research.getByText("Pourquoi les capsules de bière ont 21 dents")).toBeVisible();
    const publication = page.getByRole("region", { name: "Publication" });
    await expect(publication.getByText("Le secret du trombone")).toBeVisible();
    expect(await queueBadge(page)).toBe("3");
  });
});
