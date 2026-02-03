# Testing: Subscription Tiers and Property Limits

## Reducing active subscriptions for a test account

Use the **admin set-subscription** endpoint to change a user's tier or status without going through Stripe. This lets you downgrade a test account (e.g. from PORTFOLIO to STARTER) or simulate cancelled/inactive.

### Endpoint

- **POST** `/api/admin/set-subscription` — set a user's tier and status  
- **GET** `/api/admin/set-subscription` — list users or get one user's subscription info  

### Auth

- **Header:** `x-admin-secret: YOUR_ADMIN_SECRET` (set `ADMIN_SECRET` in Vercel env vars), **or**
- Logged in as a user with **role: ADMIN**

### Set a lower tier (e.g. for testing limits)

**PowerShell (Windows):** Use `Invoke-RestMethod` — in PowerShell, `curl` is an alias for `Invoke-WebRequest` and does not support `-X` / `-H` / `-d`.

```powershell
Invoke-RestMethod -Uri "https://www.overtaxed-il.com/api/admin/set-subscription" -Method POST -ContentType "application/json" -Headers @{ "x-admin-secret" = "YOUR_ADMIN_SECRET" } -Body '{"email": "your-test@example.com", "subscriptionTier": "STARTER", "subscriptionStatus": "ACTIVE"}'
```

**Bash / Git Bash / Linux:** Use `curl`:

```bash
curl -X POST https://www.overtaxed-il.com/api/admin/set-subscription \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: YOUR_ADMIN_SECRET" \
  -d '{"email": "your-test@example.com", "subscriptionTier": "STARTER", "subscriptionStatus": "ACTIVE"}'
```

**Tiers:** `COMPS_ONLY` (1 property), `STARTER` (2), `GROWTH` (9), `PORTFOLIO` (20), `PERFORMANCE` (999).  
**Status:** `ACTIVE`, `INACTIVE`, `PAST_DUE`, `CANCELLED`.

To simulate “no active subscription” (e.g. back to free/comps-only behavior), set:

- `subscriptionTier: "COMPS_ONLY"` and `subscriptionStatus: "ACTIVE"`, **or**
- `subscriptionStatus: "CANCELLED"` (keeps tier but marks as cancelled).

### Get current subscription (to confirm)

**PowerShell:**

```powershell
# One user by email
Invoke-RestMethod -Uri "https://www.overtaxed-il.com/api/admin/set-subscription?email=your-test@example.com" -Headers @{ "x-admin-secret" = "YOUR_ADMIN_SECRET" }

# All users (last 50)
Invoke-RestMethod -Uri "https://www.overtaxed-il.com/api/admin/set-subscription" -Headers @{ "x-admin-secret" = "YOUR_ADMIN_SECRET" }
```

**Bash:**

```bash
curl -H "x-admin-secret: YOUR_ADMIN_SECRET" "https://www.overtaxed-il.com/api/admin/set-subscription?email=your-test@example.com"
curl -H "x-admin-secret: YOUR_ADMIN_SECRET" "https://www.overtaxed-il.com/api/admin/set-subscription"
```

Response includes `subscriptionTier`, `subscriptionStatus`, and `_count.properties` so you can see how many properties they have vs. limit.

---

## How to test property limits

Limits are enforced in **POST /api/properties** (add property). The UI (e.g. Add Property page) should disable or show an error when at limit; the API returns **403** with a clear message when over limit.

### Property limits by tier

| Tier         | Property limit |
|-------------|-----------------|
| COMPS_ONLY  | 1               |
| STARTER     | 2               |
| GROWTH      | 9               |
| PORTFOLIO   | 20              |
| PERFORMANCE | 999             |

### Test steps

1. **Set your test user to STARTER (limit 2)**  
   **PowerShell:**  
   `Invoke-RestMethod -Uri "https://www.overtaxed-il.com/api/admin/set-subscription" -Method POST -ContentType "application/json" -Headers @{ "x-admin-secret" = "YOUR_ADMIN_SECRET" } -Body '{"email": "test@example.com", "subscriptionTier": "STARTER", "subscriptionStatus": "ACTIVE"}'`  
   **Bash:**  
   `curl -X POST ...` (see “Set a lower tier” above).

2. **Sign in as that user** in the app.

3. **Add 2 properties** (e.g. via Add Property with valid Cook County PINs). Both should succeed.

4. **Try to add a 3rd property.**  
   - **API:** You should get **403** and a body like:  
     `{"error": "Property limit reached (2 for your plan). Upgrade to add more properties.", "limit": 2, "currentCount": 2}`  
   - **UI:** The Add Property flow should show an upgrade or limit message (if the front end checks limit/count).

5. **Optional: test upgrade path**  
   - Set tier to **GROWTH** (limit 9) and confirm you can add a 3rd property.  
   - Set tier back to **COMPS_ONLY** (1) and confirm only 1 property is allowed.

### Where limits are enforced

- **Backend:** `lib/billing/limits.ts` — `getPropertyLimit(tier, subscriptionQuantity)`, `canAddProperty(count, tier, subscriptionQuantity)`. When `subscriptionQuantity` is set (e.g. from Stripe), the effective limit is that value (slots paid for); when null, the tier’s default max is used.
- **API:** `app/api/properties/route.ts` (POST) — fetches user tier and `subscriptionQuantity` from DB, computes limit, returns 403 when `count >= limit` or when over 20 (custom pricing message).

Session/JWT can be stale after you change tier via set-subscription; the API uses **DB tier and subscriptionQuantity** for the limit check, so the new limit applies immediately.

### Capping by quantity paid (annual billing)

Slots are capped by **quantity paid** when the user has a Stripe subscription: `subscriptionQuantity` is set from checkout and kept in sync via `customer.subscription.updated`. For testing without Stripe you can set it via the admin API:

```json
{ "email": "you@example.com", "subscriptionTier": "GROWTH", "subscriptionStatus": "ACTIVE", "subscriptionQuantity": 5 }
```

That gives the user a limit of **5** (not the tier max of 9). Omit `subscriptionQuantity` or set it to `null` to use the tier’s default max.
