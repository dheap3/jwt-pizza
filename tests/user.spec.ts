import { test, expect } from "playwright-test-coverage";
import type { Page } from "@playwright/test";

test.describe("updateUser", () => {
  let email: string;

  test.beforeEach(async ({ page }) => {
    email = `user${Math.floor(Math.random() * 10000)}@jwt.com`;
    await page.goto("/");
    await page.getByRole("link", { name: "Register" }).click();
    await page.getByRole("textbox", { name: "Full name" }).fill("pizza diner");
    await page.getByRole("textbox", { name: "Email address" }).fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill("diner");
    await page.getByRole("button", { name: "Register" }).click();

    await page.getByRole("link", { name: "pd" }).click();

    await expect(page.getByRole("main")).toContainText("pizza diner");
  });

  // field: 0 = name, 1 = email, 2 = password
  async function editField(page: Page, field: number, value: string) {
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.locator("h3")).toContainText("Edit user");
    await page.getByRole("textbox").nth(field).fill(value);
    await page.getByRole("button", { name: "Update" }).click();

    await page.waitForSelector('[role="dialog"].hidden', { state: "attached" });
  }

  async function logoutAndLogin(page: Page, loginEmail: string, password: string) {
    await page.getByRole('link', { name: 'Logout' }).click();
    await page.getByRole('link', { name: 'Login' }).click();

    await page.getByRole('textbox', { name: 'Email address' }).fill(loginEmail);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await page.getByRole('link', { name: 'pd' }).click();
  }

  test("edit name field", async ({ page }) => {
    await editField(page, 0, "pizza dinerx");
    await expect(page.getByRole("main")).toContainText("pizza dinerx");

    await logoutAndLogin(page, email, "diner");
    await expect(page.getByRole('main')).toContainText('pizza dinerx');
  });

  test("edit email field", async ({ page }) => {
    const newEmail = `x${email}`;
    await editField(page, 1, newEmail);
    await expect(page.getByRole("main")).toContainText(newEmail);

    await logoutAndLogin(page, newEmail, "diner");
    await expect(page.getByRole('main')).toContainText(newEmail);
  });

  test("edit password field", async ({ page }) => {
    await editField(page, 2, "newpassword");

    await logoutAndLogin(page, email, "newpassword");
    await expect(page.getByRole('main')).toContainText(email);
  });
})
