# Introduction to JWT Pizza (frontend)

This describes how the `jwt-pizza` repo is put together and how its pieces talk to each other, from the moment the page loads to a full pizza-ordering flow. It deliberately stays inside this repo — it does not cover `jwt-pizza-service` (the backend) or the pizza factory, except to show where the frontend hands off to them.

## 1. What this repo actually is

`jwt-pizza` is a single-page React app built with **Vite**, styled with **Tailwind**, using **Preline** for pre-built UI components (nav bars, modals, tooltips, carousels), and **react-router-dom** for client-side routing. It is *only* the UI — it owns no business logic and no database. Every real action (auth, orders, franchises) is delegated over HTTP to two external services:

- **`jwt-pizza-service`** — the main backend API (auth, users, orders, franchises, stores).
- **the pizza factory** (a separate service, URL from `VITE_PIZZA_FACTORY_URL`) — verifies the JWT stamped on a completed order.

## 2. Boot sequence

1. [index.html](index.html) loads [index.tsx](index.tsx), which mounts `<App />` (from [src/app/app.tsx](src/app/app.tsx)) into the DOM inside a `BrowserRouter`.
2. [app.tsx](src/app/app.tsx) is the root component. On mount it:
   - Calls `pizzaService.getUser()` to see if a JWT is already stored in `localStorage` and, if so, fetches the current user — this is how a page refresh "remembers" you're logged in.
   - Declares a single array, `navItems`, that is simultaneously the **route table** (`to` + `component` per entry, rendered via `<Routes>`/`<Route>`) and the **nav menu** (each item also says whether it shows in the top nav, the footer, both, or neither, and optional `constraints` — functions like `isAdmin`/`loggedOut` that gate visibility).
   - Renders `<Header>`, a `<Breadcrumb>`, the routed `<main>` content, and `<Footer>`.

This "one array drives both routing and navigation" pattern is the main architectural idea to notice — there's no separate router config file.

## 3. The service layer — the one place that talks to the network

Everything a view needs from the backend goes through `pizzaService`, imported from [src/service/service.ts](src/service/service.ts). That file just does:

```ts
let pizzaService: PizzaService = httpPizzaService;
```

- [src/service/pizzaService.ts](src/service/pizzaService.ts) defines the `PizzaService` **interface** plus every shared type (`User`, `Menu`, `Order`, `Franchise`, `Store`, `Role`, etc). Views only ever import types and the `pizzaService` singleton from here — never `fetch` directly.
- [src/service/httpPizzaService.ts](src/service/httpPizzaService.ts) is the concrete implementation. It has one private workhorse, `callEndpoint(path, method, body)`, that:
  - Prefixes relative paths with `VITE_PIZZA_SERVICE_URL` (set in [.env.development](.env.development) / [.env.production](.env.production)).
  - Attaches `Authorization: Bearer <token>` from `localStorage` on every call, if a token exists.
  - Sends/receives JSON, and rejects with `{ code, message }` on a non-OK response.
  - Every public method (`login`, `register`, `logout`, `getMenu`, `order`, `getFranchise`, ...) is a thin wrapper around one `callEndpoint` call with a specific verb + path.

Because there's an interface, the app could swap in a mock/local implementation of `PizzaService` for testing without touching any view — that's the reason for the indirection.

### Full endpoint map (frontend → backend)

| Method | Verb & path | Talks to |
| --- | --- | --- |
| `login` | `PUT /api/auth` | jwt-pizza-service |
| `register` | `POST /api/auth` | jwt-pizza-service |
| `logout` | `DELETE /api/auth` | jwt-pizza-service |
| `getUser` | `GET /api/user/me` | jwt-pizza-service |
| `getMenu` | `GET /api/order/menu` | jwt-pizza-service |
| `getOrders` | `GET /api/order` | jwt-pizza-service |
| `order` | `POST /api/order` | jwt-pizza-service |
| `verifyOrder` | `POST /api/order/verify` | **pizza factory** (different base URL) |
| `getFranchise` | `GET /api/franchise/:userId` | jwt-pizza-service |
| `getFranchises` | `GET /api/franchise?page=&limit=&name=` | jwt-pizza-service |
| `createFranchise` | `POST /api/franchise` | jwt-pizza-service |
| `closeFranchise` | `DELETE /api/franchise/:franchiseId` | jwt-pizza-service |
| `createStore` | `POST /api/franchise/:franchiseId/store` | jwt-pizza-service |
| `closeStore` | `DELETE /api/franchise/:franchiseId/store/:storeId` | jwt-pizza-service |
| `docs` | `GET /api/docs` (or factory's `/api/docs` for `docType === 'factory'`) | either, depending on argument |

## 4. Auth & identity, end to end

1. **Register** ([register.tsx](src/views/register.tsx)): a form collects name/email/password, calls `pizzaService.register()`. On success the JWT service returns `{ user, token }`; `httpPizzaService` stores `token` in `localStorage` and returns `user`, which `App` puts into its `user` state via the `setUser` prop passed down.
2. **Login** ([login.tsx](src/views/login.tsx)): same pattern with `PUT /api/auth`.
3. **Session persistence**: the token lives only in `localStorage`, keyed as `"token"`. There is no cookie session — every request re-attaches the bearer token in `httpPizzaService.callEndpoint`. On app boot, `getUser()` uses the presence of that token to decide whether to call `GET /api/user/me`; if that call fails (expired/invalid token) the token is cleared.
4. **Logout** ([logout.tsx](src/views/logout.tsx)): fires `DELETE /api/auth`, clears `localStorage`, sets `user` back to `null`, and navigates home. Note this component has no UI decision to make — it does the logout as a side effect of mounting.
5. **Role gating**: `Role.isRole(user, Role.Admin)` (and similar checks) are plain functions in [pizzaService.ts](src/service/pizzaService.ts) that look at `user.roles`. `App`'s `navItems` uses these as `constraints` to hide/show nav links, and individual views (like [adminDashboard.tsx](src/views/adminDashboard.tsx)) re-check the role themselves before rendering real content (rendering `<NotFound />` otherwise) — so gating happens at both the nav layer and the view layer.

## 5. The pizza-ordering flow (the core user journey)

This is the flow that ties the most pieces together, so it's worth tracing in full:

1. **[menu.tsx](src/views/menu.tsx)** — on mount, calls `getMenu()` (the list of pizza types) *and* `getFranchises(0, 20, '*')` (to build a map of every store across every franchise, so the user can pick a pickup location). Clicking pizzas accumulates an `order.items` array in local component state; picking a store sets `order.storeId`/`order.franchiseId`. "Checkout" just `navigate()`s to `/payment`, handing the in-progress `order` object through React Router's location `state` — nothing is persisted server-side yet.
2. **[payment.tsx](src/views/payment.tsx)** — reads the `order` back out of `location.state`. On mount it re-checks `getUser()`; if there's no logged-in user it redirects to `/login` (preserving the pending order in state so the user lands back here after logging in). "Pay now" calls `pizzaService.order(order)`, i.e. `POST /api/order` — this is the one call that actually creates the order server-side and returns `{ order, jwt }` (the `jwt` is a signed receipt for that specific order). On success it navigates to `/delivery` with that response in state.
3. **[delivery.tsx](src/views/delivery.tsx)** — shows the order confirmation and the raw JWT. Clicking "Verify" calls `pizzaService.verifyOrder(jwt)`, which — unlike every other call — goes to the **pizza factory**, not `jwt-pizza-service`. This checks the JWT's signature/validity and shows the decoded payload in a modal, colored green/red for valid/invalid. This is the one place in the app that demonstrates JWTs are cryptographically verifiable independent of the backend that issued them.

So a single order touches: local-only state (menu selection) → `jwt-pizza-service` (place order) → the pizza factory (verify order), with React Router `state` as the transport for the in-progress order between screens rather than any global store or persisted cart.

## 6. Diner, franchisee, and admin — three views of the same data

- **Diner dashboard** ([dinerDashboard.tsx](src/views/dinerDashboard.tsx)): calls `getOrders(user)` → `GET /api/order`, shows the logged-in user's own past orders and profile info.
- **Franchise dashboard** ([franchiseDashboard.tsx](src/views/franchiseDashboard.tsx)): calls `getFranchise(user)` → `GET /api/franchise/:userId`. If the user owns a franchise, it lists that franchise's stores with revenue and "Close" actions (`createStore`/`closeStore` navigate to dedicated confirm-and-submit screens: [createStore.tsx](src/views/createStore.tsx), [closeStore.tsx](src/views/closeStore.tsx)). If the user has no franchise, it instead renders a static marketing pitch (`whyFranchise()`) with no network call.
- **Admin dashboard** ([adminDashboard.tsx](src/views/adminDashboard.tsx)): only rendered for admins (checked inline, not just at the nav level). Calls `getFranchises(page, limit, nameFilter)` → `GET /api/franchise?...` to list **every** franchise (paginated, filterable by name), each with its stores, and lets the admin create franchises ([createFranchise.tsx](src/views/createFranchise.tsx)) or close any franchise/store ([closeFranchise.tsx](src/views/closeFranchise.tsx), reusing the same `closeStore` flow as the franchisee view).

The pattern across all three: the *same* underlying franchise/store data is fetched with different scoping (`GET /api/franchise/:userId` for "mine" vs `GET /api/franchise?...` for "all"), and the UI/permissions differ, but they funnel through the same `pizzaService` methods and the same `createStore`/`closeStore`/`createFranchise`/`closeFranchise` screens (which pass the relevant `franchise`/`store` objects via router `state`, same trick as the order flow).

## 7. Supporting pieces

- **[view.tsx](src/views/view.tsx)** — a thin wrapper most pages use for a consistent title/layout.
- **[header.tsx](src/app/header.tsx) / [footer.tsx](src/app/footer.tsx)** — render nav links by filtering `App`'s `navItems` on `display` (`'nav'`/`'footer'`) and evaluating each item's `constraints` against the current `user`.
- **[breadcrumb.tsx](src/components/breadcrumb.tsx)** + **[appNavigation.tsx](src/hooks/appNavigation.tsx)** — the app nests some routes under a path segment (e.g. `/franchise-dashboard/create-store`). `useBreadcrumb()` is a small hook used by the create/close/login/register screens to navigate back "up" one path segment after a submit or cancel, so those screens work whether they were reached from the diner, franchisee, or admin context.
- **[docs.tsx](src/views/docs.tsx)** — calls `pizzaService.docs(docType)`, which hits `GET /api/docs` on either `jwt-pizza-service` or the pizza factory depending on the `docType` param, and renders the returned endpoint list — this is effectively a self-documenting API explorer for whichever backend you pick.
- **Presentational components** ([button.tsx](src/components/button.tsx), [card.tsx](src/components/card.tsx), [carousel.tsx](src/components/carousel.tsx), [slide.tsx](src/components/slide.tsx), [quote.tsx](src/components/quote.tsx), [icons.tsx](src/icons.tsx)) — no service calls, pure UI.
- **Config**: `.env.development` / `.env.production` set `VITE_PIZZA_SERVICE_URL` and `VITE_PIZZA_FACTORY_URL`, i.e. which backend/factory instance the frontend targets in each mode. `deployService.sh` and `public/version.json` relate to deployment, not runtime behavior.

## 8. The one-sentence mental model

**Every screen is a route in `App`'s single `navItems` table; every screen that needs data calls a method on the `pizzaService` singleton; `httpPizzaService` turns each of those into one bearer-authenticated HTTP call to either `jwt-pizza-service` or (only for order verification and factory docs) the pizza factory; and in-progress objects like a pending order, a franchise, or a store are passed between screens via React Router navigation `state` rather than any global store.**
