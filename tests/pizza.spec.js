import { test, expect } from "playwright-test-coverage";
import { Role } from "../src/service/pizzaService";

async function basicInit(page) {
  let loggedInUser;
  const validUsers = {
    "d@jwt.com": { id: "3", name: "Kai Chen", email: "d@jwt.com", password: "a", roles: [{ role: Role.Diner }] },
    "f@jwt.com": {
      id: "5",
      name: "Franny Franchisee",
      email: "f@jwt.com",
      password: "f",
      roles: [{ role: Role.Diner }, { role: Role.Franchisee, objectId: "2" }],
    },
    "a@jwt.com": { id: "1", name: "Ada Admin", email: "a@jwt.com", password: "admin", roles: [{ role: Role.Admin }] },
  };

  const franchises = [
    {
      id: 2,
      name: "LotaPizza",
      admins: [{ id: "5", name: "Franny Franchisee", email: "f@jwt.com" }],
      stores: [
        { id: 4, name: "Lehi", totalRevenue: 0.05 },
        { id: 5, name: "Springville", totalRevenue: 0.1 },
        { id: 6, name: "American Fork", totalRevenue: 0.2 },
      ],
    },
    { id: 3, name: "PizzaCorp", stores: [{ id: 7, name: "Spanish Fork" }] },
    { id: 4, name: "topSpot", stores: [] },
  ];
  let nextFranchiseId = 10;
  let nextStoreId = 20;

  const ordersByUserId = {
    3: [
      {
        id: 1,
        franchiseId: 2,
        storeId: 4,
        date: "2024-06-05T05:14:40.000Z",
        items: [
          { menuId: 1, description: "Veggie", price: 0.0038 },
          { menuId: 2, description: "Pepperoni", price: 0.0042 },
        ],
      },
      {
        id: 2,
        franchiseId: 2,
        storeId: 5,
        date: "2024-06-06T05:14:40.000Z",
        items: [{ menuId: 1, description: "Veggie", price: 0.05 }],
      },
    ],
  };

  await page.route("*/**/api/auth", async (route) => {
    const method = route.request().method();

    // Logout
    if (method === "DELETE") {
      loggedInUser = undefined;
      await route.fulfill({ json: { message: "logout successful" } });
      return;
    }

    // Register
    if (method === "POST") {
      const registerReq = route.request().postDataJSON();
      if (validUsers[registerReq.email]) {
        await route.fulfill({ status: 409, json: { message: "user already exists" } });
        return;
      }
      const newUser = {
        id: "10",
        name: registerReq.name,
        email: registerReq.email,
        password: registerReq.password,
        roles: [{ role: Role.Diner }],
      };
      validUsers[registerReq.email] = newUser;
      loggedInUser = newUser;
      await route.fulfill({ json: { user: newUser, token: "ghijkl" } });
      return;
    }

    // Login
    const loginReq = route.request().postDataJSON();
    const user = validUsers[loginReq.email];
    if (!user || user.password !== loginReq.password) {
      await route.fulfill({ status: 401, json: { error: "Unauthorized" } });
      return;
    }
    loggedInUser = validUsers[loginReq.email];
    const loginRes = {
      user: loggedInUser,
      token: "abcdef",
    };
    expect(method).toBe("PUT");
    await route.fulfill({ json: loginRes });
  });

  await page.route("*/**/api/user/me", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: loggedInUser });
  });

  await page.route("*/**/api/order/menu", async (route) => {
    const menuRes = [
      { id: 1, title: "Veggie", image: "pizza1.png", price: 0.0038, description: "A garden of delight" },
      { id: 2, title: "Pepperoni", image: "pizza2.png", price: 0.0042, description: "Spicy treat" },
    ];
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: menuRes });
  });

  // List franchises (GET) and create franchise (POST)
  await page.route(/\/api\/franchise(\?.*)?$/, async (route) => {
    const method = route.request().method();

    if (method === "POST") {
      const franchiseReq = route.request().postDataJSON();
      const admins = (franchiseReq.admins || []).map((admin) => {
        const user = validUsers[admin.email];
        return user ? { id: user.id, name: user.name, email: user.email } : null;
      });
      if (admins.length === 0 || admins.includes(null)) {
        await route.fulfill({ status: 404, json: { message: "unknown user for franchise admin" } });
        return;
      }
      const newFranchise = { id: nextFranchiseId++, name: franchiseReq.name, admins, stores: [] };
      franchises.push(newFranchise);
      await route.fulfill({ json: newFranchise });
      return;
    }

    expect(method).toBe("GET");
    await route.fulfill({ json: { franchises, more: false } });
  });

  // Get the franchises a user administers
  await page.route(/\/api\/franchise\/(\d+)$/, async (route) => {
    expect(route.request().method()).toBe("GET");
    const userId = route
      .request()
      .url()
      .match(/\/api\/franchise\/(\d+)$/)[1];
    const userFranchises = franchises.filter((f) => f.admins?.some((a) => a.id === userId));
    await route.fulfill({ json: userFranchises });
  });

  // Create store
  await page.route(/\/api\/franchise\/(\d+)\/store$/, async (route) => {
    expect(route.request().method()).toBe("POST");
    const franchiseId = route
      .request()
      .url()
      .match(/\/api\/franchise\/(\d+)\/store$/)[1];
    const franchise = franchises.find((f) => String(f.id) === franchiseId);
    if (!franchise) {
      await route.fulfill({ status: 404, json: { message: "franchise not found" } });
      return;
    }
    const storeReq = route.request().postDataJSON();
    const newStore = { id: nextStoreId++, name: storeReq.name, totalRevenue: 0 };
    franchise.stores.push(newStore);
    await route.fulfill({ json: newStore });
  });

  // Order history (GET) and place order (POST)
  await page.route("*/**/api/order", async (route) => {
    const method = route.request().method();

    if (method === "GET") {
      const orders = (loggedInUser && ordersByUserId[loggedInUser.id]) || [];
      await route.fulfill({ json: { id: 1, dinerId: loggedInUser?.id, orders } });
      return;
    }

    const orderReq = route.request().postDataJSON();
    const orderRes = {
      order: { ...orderReq, id: 23 },
      jwt: "eyJpYXQ",
    };
    expect(method).toBe("POST");
    await route.fulfill({ json: orderRes });
  });

  await page.goto("/");
}

async function login(page, email, password) {
  await headerNav(page).getByRole("link", { name: "Login" }).click();
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Login" }).click();
}

function headerNav(page) {
  return page.getByLabel("Global");
}

test("login", async ({ page }) => {
  await basicInit(page);
  await page.getByRole("link", { name: "Login" }).click();
  await page.getByRole("textbox", { name: "Email address" }).fill("d@jwt.com");
  await page.getByRole("textbox", { name: "Password" }).fill("a");
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByRole("link", { name: "KC" })).toBeVisible();
});

test("logout", async ({ page }) => {
  await basicInit(page);
  await login(page, "d@jwt.com", "a");
  await expect(page.getByRole("link", { name: "KC", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBe("abcdef");

  const logoutRequest = page.waitForRequest((req) => req.url().endsWith("/api/auth") && req.method() === "DELETE");
  await headerNav(page).getByRole("link", { name: "Logout" }).click();
  const req = await logoutRequest;
  expect(req.headers()["authorization"]).toBe("Bearer abcdef");

  // Back on the home page, logged out
  await expect(headerNav(page).getByRole("link", { name: "Login" })).toBeVisible();
  await expect(headerNav(page).getByRole("link", { name: "Register" })).toBeVisible();
  await expect(headerNav(page).getByRole("link", { name: "Logout" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "KC", exact: true })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/");
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();

  // Still logged out after a reload
  await page.reload();
  await expect(headerNav(page).getByRole("link", { name: "Login" })).toBeVisible();
  await expect(page.getByRole("link", { name: "KC", exact: true })).toHaveCount(0);
});

test("register", async ({ page }) => {
  await basicInit(page);
  await headerNav(page).getByRole("link", { name: "Register" }).click();
  await expect(page.getByText("Welcome to the party")).toBeVisible();

  await page.getByPlaceholder("Full name").fill("Pat Doe");
  await page.getByPlaceholder("Email address").fill("pat@jwt.com");
  await page.getByPlaceholder("Password").fill("secret");

  const registerRequest = page.waitForRequest((req) => req.url().endsWith("/api/auth") && req.method() === "POST");
  await page.getByRole("button", { name: "Register" }).click();
  const req = await registerRequest;
  expect(req.postDataJSON()).toEqual({ name: "Pat Doe", email: "pat@jwt.com", password: "secret" });

  // Registered user is logged in and returned to the home page
  await expect(page.getByRole("link", { name: "PD", exact: true })).toBeVisible();
  await expect(headerNav(page).getByRole("link", { name: "Logout" })).toBeVisible();
  await expect(headerNav(page).getByRole("link", { name: "Login" })).toHaveCount(0);
  await expect(headerNav(page).getByRole("link", { name: "Register" })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/");
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBe("ghijkl");

  // New user shows up on the diner dashboard
  await page.getByRole("link", { name: "PD", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Pat Doe");
  await expect(page.getByRole("main")).toContainText("pat@jwt.com");
});

test("register with existing email shows error", async ({ page }) => {
  await basicInit(page);
  await headerNav(page).getByRole("link", { name: "Register" }).click();

  await page.getByPlaceholder("Full name").fill("Kai Chen");
  await page.getByPlaceholder("Email address").fill("d@jwt.com");
  await page.getByPlaceholder("Password").fill("a");
  await page.getByRole("button", { name: "Register" }).click();

  await expect(page.getByRole("main")).toContainText("409");
  await expect(page.getByRole("main")).toContainText("user already exists");
  await expect(headerNav(page).getByRole("link", { name: "Login" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/register");
});

test("purchase with login", async ({ page }) => {
  await basicInit(page);

  await page.getByRole("button", { name: "Order now" }).click();

  await expect(page.locator("h2")).toContainText("Awesome is a click away");
  await page.getByRole("combobox").selectOption("4");
  await page.getByRole("link", { name: "Image Description Veggie A" }).click();
  await page.getByRole("link", { name: "Image Description Pepperoni" }).click();
  await expect(page.locator("form")).toContainText("Selected pizzas: 2");
  await page.getByRole("button", { name: "Checkout" }).click();

  await page.getByPlaceholder("Email address").fill("d@jwt.com");
  await page.getByPlaceholder("Password").fill("a");
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByRole("main")).toContainText("Send me those 2 pizzas right now!");
  await expect(page.locator("tbody")).toContainText("Veggie");
  await expect(page.locator("tbody")).toContainText("Pepperoni");
  await expect(page.locator("tfoot")).toContainText("0.008 ₿");
  await page.getByRole("button", { name: "Pay now" }).click();

  await expect(page.getByText("0.008")).toBeVisible();
});

test("diner dashboard shows user info and order history", async ({ page }) => {
  await basicInit(page);
  await login(page, "d@jwt.com", "a");

  await page.getByRole("link", { name: "KC", exact: true }).click();
  await expect(page.getByText("Your pizza kitchen")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/diner-dashboard");

  const main = page.getByRole("main");
  await expect(main).toContainText("Kai Chen");
  await expect(main).toContainText("d@jwt.com");
  await expect(main).toContainText("diner");
  await expect(main).toContainText("Here is your history of all the good times.");

  const rows = main.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator("td").first()).toHaveText("1");
  await expect(rows.nth(0)).toContainText("0.008 ₿");
  await expect(rows.nth(0)).toContainText("2024-06-05T05:14:40.000Z");
  await expect(rows.nth(1)).toContainText("0.05 ₿");
});

test("diner dashboard with no orders and franchisee role", async ({ page }) => {
  await basicInit(page);
  await login(page, "f@jwt.com", "f");

  await page.getByRole("link", { name: "FF", exact: true }).click();
  const main = page.getByRole("main");
  await expect(main).toContainText("Franny Franchisee");
  await expect(main).toContainText("f@jwt.com");
  await expect(main).toContainText("diner, Franchisee on 2");
  await expect(main).toContainText("How have you lived this long without having a pizza?");
  await expect(main.locator("table")).toHaveCount(0);

  await main.getByRole("link", { name: "Buy one" }).click();
  await expect(page.getByText("Awesome is a click away")).toBeVisible();
});

test("franchise dashboard when not a franchisee", async ({ page }) => {
  await basicInit(page);

  // Not logged in
  await headerNav(page).getByRole("link", { name: "Franchise" }).click();
  await expect(page.getByText("So you want a piece of the pie?")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "login", exact: true })).toBeVisible();

  // Logged in as a diner with no franchise
  await login(page, "d@jwt.com", "a");
  await headerNav(page).getByRole("link", { name: "Franchise" }).click();
  await expect(page.getByText("So you want a piece of the pie?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create store" })).toHaveCount(0);
});

test("franchise dashboard for franchisee", async ({ page }) => {
  await basicInit(page);
  await login(page, "f@jwt.com", "f");

  const franchiseRequest = page.waitForRequest((req) => /\/api\/franchise\/\d+$/.test(req.url()) && req.method() === "GET");
  await headerNav(page).getByRole("link", { name: "Franchise" }).click();
  const req = await franchiseRequest;
  expect(req.url()).toMatch(/\/api\/franchise\/5$/);

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "LotaPizza" })).toBeVisible();
  await expect(main).toContainText("Everything you need to run an JWT Pizza franchise.");

  const rows = main.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Lehi");
  await expect(rows.nth(0)).toContainText("0.05 ₿");
  await expect(rows.nth(1)).toContainText("Springville");
  await expect(rows.nth(1)).toContainText("0.1 ₿");
  await expect(rows.nth(2)).toContainText("American Fork");
  await expect(rows.nth(2)).toContainText("0.2 ₿");
  await expect(main.getByRole("button", { name: "Create store" })).toBeVisible();
});

test("create store", async ({ page }) => {
  await basicInit(page);
  await login(page, "f@jwt.com", "f");
  await headerNav(page).getByRole("link", { name: "Franchise" }).click();
  await expect(page.getByRole("heading", { name: "LotaPizza" })).toBeVisible();

  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: "Create store" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/franchise-dashboard/create-store");

  await page.getByPlaceholder("store name").fill("Provo");
  const createRequest = page.waitForRequest((req) => /\/api\/franchise\/\d+\/store$/.test(req.url()) && req.method() === "POST");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const req = await createRequest;
  expect(req.url()).toMatch(/\/api\/franchise\/2\/store$/);
  expect(req.postDataJSON()).toMatchObject({ name: "Provo" });

  // Back on the franchise dashboard with the new store listed
  await expect(page.getByRole("heading", { name: "LotaPizza" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/franchise-dashboard");
  const rows = page.getByRole("main").locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: "Provo" })).toContainText("0 ₿");
});

test("create store cancel", async ({ page }) => {
  await basicInit(page);
  await login(page, "f@jwt.com", "f");
  await headerNav(page).getByRole("link", { name: "Franchise" }).click();
  await page.getByRole("button", { name: "Create store" }).click();
  await page.getByPlaceholder("store name").fill("Never Opened");
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("heading", { name: "LotaPizza" })).toBeVisible();
  await expect(page.getByRole("main").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByRole("main")).not.toContainText("Never Opened");
});

test("create franchise", async ({ page }) => {
  await basicInit(page);
  await login(page, "a@jwt.com", "admin");

  await expect(headerNav(page).getByRole("link", { name: "Franchise" })).toHaveCount(0);
  await headerNav(page).getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();

  await page.getByRole("button", { name: "Add Franchise" }).click();
  await expect(page.getByRole("heading", { name: "Create franchise" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/admin-dashboard/create-franchise");

  await page.getByPlaceholder("franchise name").fill("PizzaPalace");
  await page.getByPlaceholder("franchisee admin email").fill("f@jwt.com");
  const createRequest = page.waitForRequest((req) => /\/api\/franchise$/.test(req.url()) && req.method() === "POST");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const req = await createRequest;
  expect(req.postDataJSON()).toMatchObject({ name: "PizzaPalace", admins: [{ email: "f@jwt.com" }] });

  // Back on the admin dashboard with the new franchise listed
  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/admin-dashboard");
  const newRow = page.getByRole("main").locator("tr", { hasText: "PizzaPalace" });
  await expect(newRow).toBeVisible();
  await expect(newRow).toContainText("Franny Franchisee");
});

test("create franchise cancel", async ({ page }) => {
  await basicInit(page);
  await login(page, "a@jwt.com", "admin");
  await headerNav(page).getByRole("link", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "Add Franchise" }).click();

  await page.getByPlaceholder("franchise name").fill("Never Opened");
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Never Opened");
});
