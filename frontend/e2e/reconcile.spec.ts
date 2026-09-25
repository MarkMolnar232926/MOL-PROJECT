import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sapAssetIds } from "./xlsx";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../tests/fixtures/Inventory_Reconciliation_Practice_1.xlsx");

async function uploadFixture(page: Page) {
  await page.goto("/");
  await page.getByLabel("Workbook (.xlsx / .xlsm)").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Upload and reconcile" }).click();
  await expect(page.getByText("Detected sheets")).toBeVisible();
  await expect(page.getByText(/Physical_Inventory \(by sheet name\), 84 rows/)).toBeVisible();
  await page.getByRole("button", { name: "View results" }).click();
  await expect(page.getByTestId("kpi-needs-decision")).toHaveText("17");
}

test("upload, accept all tie suggestions, export", async ({ page }) => {
  await uploadFixture(page);

  await page.getByRole("tab", { name: /Ties/ }).click();
  await expect(page.getByTestId("ties-remaining")).toHaveText("17 of 17 slots need a decision");
  await expect(page.getByTestId("tie-group")).toHaveCount(7);
  await page.getByRole("button", { name: "Accept all suggestions" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("all 17 undecided slots");
  await dialog.getByRole("button", { name: "Accept all suggestions" }).click();
  await expect(page.getByTestId("ties-remaining")).toHaveText("0 of 17 slots need a decision");
  await expect(page.getByTestId("kpi-needs-decision")).toHaveText("0");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel" }).click(); // nothing pending: no dialog
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^reconciled_\d{8}_\d{6}\.xlsx$/);
  expect(sapAssetIds(await download.path()).filter(Boolean)).toHaveLength(74);
});

test("export with pending ties asks for confirmation", async ({ page }) => {
  await uploadFixture(page);
  await page.getByRole("button", { name: "Export Excel" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "17 tie slots still need a decision — export anyway?",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export anyway" }).click();
  const ids = sapAssetIds(await (await downloadPromise).path());
  expect(ids.filter(Boolean)).toHaveLength(57); // unresolved slots stay empty
});
