# UAT Scenario — Cross-cutting (auth lifecycle & error paths)

**Roles:** Applicant (primary), plus an implicit RBAC check against the admin surface
**Account:** `uat-applicant@asp.dev` / `UatApplicant1!` (default seed values — see `docs/uat.md` § Running the seed)
**Goal:** Exercise the auth-lifecycle and error paths that span roles: sign-out and TOTP re-challenge, the full forgot-password → reset → sign-in loop (using the UAT reset-link endpoint), the RBAC redirect that bounces an applicant away from `/admin`, and the rate-limit (429) message on rapid sign-in attempts.

## Before you begin

- The UAT seed has been run (`pnpm seed:uat`) and both servers are running (`pnpm dev` — API on `http://localhost:6050`, UI on `http://localhost:6051`).
- TOTP has been set up for the applicant account (`pnpm uat:setup`) and the secret is enrolled in your authenticator app. See `docs/uat.md` § Setting up TOTP for each role.
- Each sign-in requires a TOTP code. After submitting email + password the app redirects to the TOTP challenge page (`/enrol`); open your authenticator app, get the current 6-digit code, enter it, and click **Verify** to complete sign-in.
- The API must be running with `UAT=true` so that `GET /api/uat/reset-links` is registered (it is set in `e2e/.env.uat` for the UAT harness). Without it, Part B's reset-link endpoint returns 404.

> **There is no in-app "Sign Out" button.** asp does not render a sign-out control in the current UI; a session ends when its cookie is cleared. Wherever a step says **sign out**, do one of the following: (a) clear the site's cookies for `localhost` in your browser's dev tools / site settings, or (b) close the window and reopen the flow in a fresh **incognito / private window**. Both end the session and force a fresh sign-in with a TOTP re-challenge. This matches the sign-out convention used in `docs/uat/mentor-scenario.md` and `docs/uat/admin-scenario.md`.

> **Scenario B modifies the applicant password.** Part B changes the password for `uat-applicant@asp.dev`. After completing Part B you **must** restore the original state, either by running the same reset flow again to set the password back to `UatApplicant1!`, or by re-running `pnpm seed:uat` to restore the seed accounts. Do not leave the UAT applicant with a non-seed password — later scenarios assume `UatApplicant1!`.

Fill in the **Pass/Fail** column for each step. Record any failure in the defect log in `docs/uat/sign-off.md`.

---

## Part A — Sign-out and re-authentication (TOTP re-challenge)

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | In a browser, navigate to `http://localhost:6051/sign-in`. Type `uat-applicant@asp.dev` in **Email**, `UatApplicant1!` in **Password**, and click **Sign in**. When redirected to `/enrol`, enter the TOTP code from your authenticator app and click **Verify**. | You land on the Experiences page (the category tab bar is visible). | |
| 2 | Sign out: open your browser's dev tools (or site settings), clear the cookies for `localhost`, and reload `http://localhost:6051/`. (Alternatively, close the window and continue in a fresh incognito window.) | The app redirects to the **Sign in** page (`/sign-in`); the Experiences page is no longer accessible. | |
| 3 | Navigate to `http://localhost:6051/sign-in` again. Type `uat-applicant@asp.dev` in **Email** and `UatApplicant1!` in **Password**, then click **Sign in**. When redirected to `/enrol`, enter the TOTP code from your authenticator app and click **Verify**. | You land on the Experiences page. Sign-in with TOTP re-challenge succeeds after a cookie-clear. | |

---

## Part B — Password reset (forgot-password → reset-link → sign-in)

> Reminder: this part changes the applicant password. Step 9 restores it.

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Sign out (clear `localhost` cookies, or use a fresh window) and navigate to `http://localhost:6051/sign-in`. Click the **Forgot password?** link near the bottom of the form. | The **Forgot password?** page loads with an **Email** field and a **Send reset link** button. | |
| 2 | In the **Email** field, type `uat-applicant@asp.dev`, then click **Send reset link**. | The page replaces the form with a **Check your email** heading and the anti-enumeration message **"If that address is registered, a reset link is on its way."** A **Back to sign in** link is shown. | |
| 3 | In a new browser tab, open `http://localhost:6050/api/uat/reset-links`. | The endpoint returns a JSON array of `{ "email": ..., "url": ... }` entries. | |
| 4 | In that JSON, find the most recent entry whose `email` is `uat-applicant@asp.dev` and copy its `url` value. | An entry for `uat-applicant@asp.dev` is present and its `url` is a full `http://localhost:6051/reset-password?token=...` link. | |
| 5 | Paste the copied `url` into the browser address bar and load it. | The **Set new password** page loads with a **New password** field, a **Confirm password** field, and a **Set new password** button. | |
| 6 | In **New password** type `UatApplicant2!`, and in **Confirm password** type `UatApplicant2!` (the same value). Click **Set new password**. | The page redirects to the **Sign in** page with a **"Password updated"** success message shown at the top. | |
| 7 | On the **Sign in** page, type `uat-applicant@asp.dev` in **Email** and the **new** password `UatApplicant2!` in **Password**, then click **Sign in**. When redirected to `/enrol`, enter the TOTP code from your authenticator app and click **Verify**. | Sign-in succeeds with the new password and you land on the Experiences page. | |
| 8 | (Mismatch check, optional) Re-open the reset URL flow and at the **Set new password** form type two different values in **New password** and **Confirm password**, then submit. | An inline error **"Passwords do not match"** appears under the **Confirm password** field and the form does not submit. | |
| 9 | **Restore the seed state.** Repeat steps 1–6 to reset the password back to `UatApplicant1!` (request a fresh reset link, retrieve it from `/api/uat/reset-links`, set the password to `UatApplicant1!` twice). **Or** run `pnpm seed:uat` to restore the seed accounts. | The applicant password is back to `UatApplicant1!`; signing in with `UatApplicant1!` succeeds. | |

---

## Part C — RBAC redirect (applicant blocked from `/admin`)

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Signed in as the applicant (sign in via `http://localhost:6051/sign-in` if you are not already signed in), navigate directly to `http://localhost:6051/admin` by typing the URL into the address bar. | The app immediately redirects to `/experiences`. No admin dashboard, no category or grant management UI, and no admin navigation are visible at any point. | |
| 2 | Confirm the address bar settles on `/experiences` (not `/admin`). | The URL is `http://localhost:6051/experiences` and the Experiences page (category tab bar) is shown. | |

---

## Part D — Rate-limit (429) on rapid sign-in attempts

> The auth rate limiter defaults to **10 requests per 60-second window** per client (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`). The 11th sign-in attempt within the window is rejected with **HTTP 429 Too Many Requests**.

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Sign out (clear `localhost` cookies, or use a fresh window) and navigate to `http://localhost:6051/sign-in`. | The **Sign in** page loads with an **Email** field, a **Password** field, and a **Sign in** button. | |
| 2 | In **Email** type any address (e.g. `uat-applicant@asp.dev`) and in **Password** type an obviously **wrong** password (e.g. `wrong-password`). | The fields are filled; the password is masked. | |
| 3 | Click **Sign in** repeatedly — at least **11 times** in rapid succession (as fast as the button allows; the failed attempts will not advance past the sign-in form). | After the request limit is exceeded, the sign-in form shows a **"Too Many Requests"** (HTTP 429) error message instead of the usual invalid-credentials message. | |
| 4 | (Optional) Wait at least 60 seconds, then attempt a valid sign-in with `uat-applicant@asp.dev` / `UatApplicant1!`. Complete the TOTP challenge when redirected to `/enrol`. | After the rate-limit window elapses, sign-in is accepted and you land on the Experiences page. | |

---

## Result

- **Overall Pass/Fail:** ______
- **Part A (sign-out / TOTP re-challenge):** ______
- **Part B (password reset):** ______
- **Part C (RBAC redirect):** ______
- **Part D (rate-limit 429):** ______
- **Tester:** ______________________
- **Date:** ______________________
- **Notes / defects raised:** ______________________

> **Post-run checklist:** Confirm the applicant password is restored to `UatApplicant1!` (Part B step 9). If in any doubt, run `pnpm seed:uat`.

Record defects in `docs/uat/sign-off.md`.
