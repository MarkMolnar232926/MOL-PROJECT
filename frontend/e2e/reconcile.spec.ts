import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetIds } from "./xlsx";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../../tests/fixtures");
const ORIGINAL = path.join(FIXTURES, "physical_inventory.xlsx");
const INCOMING = path.join(FIXTURES, "sap_export.xlsx");

async function uploadBoth(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("step-incoming")).toBeDisabled();
  await page.getByLabel("Original inventory (.xlsx / .xlsm)").setInputFiles(ORIGINAL);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByTestId("original-summary")).toContainText(
    "physical_inventory.xlsx › Munka1 (found by column headers) – 84 rows",
  );
  await expect(page.getByTestId("step-matching")).toBeDisabled();
  await page.getByRole("button", { name: "Continue to the incoming list" }).click();

  await page.getByLabel("Incoming furniture list (.xlsx / .xlsm)").setInputFiles(INCOMING);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByTestId("matched-summary")).toHaveText(
    "Matching done: 16 of 20 items resolved automatically.",
  );
  await page.getByRole("button", { name: "Go to matching" }).click();
  await expect(page.getByTestId("kpi-unresolved")).toHaveText("4");
}

async function noPair(page: Page, reason: string) {
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "No existing pair" });
  await dialog.getByLabel(reason).check();
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden();
}

test("upload both files, resolve the open items, export", async ({ page }) => {
  await uploadBoth(page);

  // export is locked while items are open
  await page.getByTestId("step-export").click();
  await expect(page.getByRole("button", { name: "Download file" })).toBeDisabled();
  await expect(page.getByTestId("export-remaining")).toContainText("4 items left");
  await page.getByRole("button", { name: "Go to the items to resolve" }).click();
  await expect(page.getByTestId("queue-progress")).toHaveText("0 / 4 resolved");

  // row 8: only Lakeside Dining Tables are left (75 %, location differs) -> assign by hand
  await expect(page.getByTestId("item-card")).toContainText("Incoming row 8");
  await expect(page.getByTestId("candidate").first()).toContainText("75%");
  await expect(page.getByTestId("candidate").first()).toContainText("Location ✗: Lakeside ≠ RVS");
  await page.keyboard.press("Enter");

  // row 14: the only Writing Desk in Riverside is defective, visible with the toggle
  await expect(page.getByTestId("item-card")).toContainText("Incoming row 14");
  await expect(page.getByText("No candidates with these filters.")).toBeVisible();
  await page.getByLabel("Show defective units").check();
  await expect(page.getByTestId("candidate")).toHaveCount(1);
  await expect(page.getByTestId("candidate")).toContainText("Defective");
  await page.getByLabel("Show defective units").uncheck();
  await noPair(page, "Missing / asset not found");

  // row 16: the Lakeside Computer Desk
  await expect(page.getByTestId("item-card")).toContainText("Incoming row 16");
  await expect(page.getByTestId("candidate").first()).toHaveAttribute("data-asset-id", "84285415");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("item-card")).toContainText("Incoming row 20");
  await noPair(page, "New asset, not in the inventory yet");
  await expect(page.getByTestId("queue-progress")).toHaveText("4 / 4 resolved");
  await expect(page.getByTestId("step-matching")).toHaveAttribute("data-done", "true");

  await page.getByTestId("step-export").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download file" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("sap_export_asset_id.xlsx");
  const ids = assetIds(await download.path());
  expect(ids).toHaveLength(20);
  expect(ids.filter(Boolean)).toHaveLength(18);
  expect(ids[0]).toBe(84236836); // row 2: the newest of the three Work Desks
  expect(ids[6]).toBe(84277502); // row 8: chosen by hand
  expect(ids[12]).toBeNull(); // row 14
  expect(ids[14]).toBe(84285415); // row 16: chosen by hand
  expect(ids[18]).toBeNull(); // row 20
});

test("the whole app is in Hungarian after switching", async ({ page }) => {
  await uploadBoth(page);
  await page.getByLabel("Language").selectOption("hu");
  await expect(page).toHaveTitle("Leltáregyeztetés");
  await expect(page.getByTestId("step-matching")).toContainText("Párosítás");
  await expect(page.getByRole("tab", { name: "Áttekintés" })).toBeVisible();
  await page.getByRole("tab", { name: /Megoldandó tételek/ }).click();
  await expect(page.getByTestId("item-card")).toContainText("Új lista 8. sora");
  await expect(page.getByTestId("item-card")).toContainText("Megoldandó – nincs pontos egyezés");
  await expect(page.getByTestId("item-card")).toContainText("minden szempontban egyezik");
  await expect(page.getByTestId("candidate").first()).toContainText("Helyszín ✗: Lakeside ≠ RVS");
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "Nincs meglévő pár" });
  await expect(dialog).toContainText("Hiányzó / nem talált eszköz");
  await dialog.getByRole("button", { name: "Mégse" }).click();
  await page.getByRole("tab", { name: "Összes tétel" }).click();
  await expect(page.getByRole("table")).toContainText("Automatikus (legújabb dátum)");
  await page.getByRole("button", { name: "Szabályok" }).click();
  await expect(page.getByText("Minden szempont egyformán számít")).toBeVisible();
  // no English UI text is left on the rules page apart from the data itself
  await expect(page.getByText("Rules and settings")).toHaveCount(0);
});

test("override an automatic pair from the table with a swap", async ({ page }) => {
  await uploadBoth(page);
  await page.getByRole("tab", { name: "All items" }).click();
  await page.getByRole("row", { name: /^2 Work Desk/ }).getByRole("button", { name: "Open" }).click();
  await expect(page.getByText("You are changing a resolved item.")).toBeVisible();
  await expect(page.getByTestId("current-asset-id")).toContainText("84236836");

  await page.getByLabel("Show already paired units").check();
  await page.locator('[data-testid="candidate"][data-asset-id="84214252"]').click();
  await page.getByRole("button", { name: "Assign 84214252" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Swap: 84214252 is assigned to row 17. Row 17 goes back");
  await dialog.getByRole("button", { name: "Swap" }).click();
  await expect(page.getByTestId("current-asset-id")).toContainText("84214252");
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByTestId("kpi-unresolved")).toHaveText("5");
  await expect(page.getByTestId("kpi-manual")).toHaveText("1");
  await expect(page.getByTestId("decision-log")).toContainText("released by a swap");
});
