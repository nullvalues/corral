# UAT Scenario — Applicant Momentum Journey

**Role:** Applicant
**Account:** `uat-applicant@asp.dev` / `UatApplicant1!` (default seed values — see `docs/uat.md` § Running the seed)
**Goal:** Sign in as the applicant, land on the `/home` dashboard, add an experience via the empty-state CTA, watch the dashboard update, cross a category goal, verify the celebration overlay appears exactly once and is debounced on reload, then exercise the bottom tab bar.

## Before you begin

- The UAT seed has been run (`pnpm seed:uat`) and both servers are running (`pnpm dev` — API on `http://localhost:6050`, UI on `http://localhost:6051`).
- TOTP has been set up for the applicant account (`pnpm uat:setup`) and the secret is enrolled in your authenticator app. See `docs/uat.md` § Setting up TOTP for each role.
- For step 3 (signing in), when prompted for TOTP, open your authenticator app, get the current 6-digit code for this account, enter it, and click **Verify**.
- Fill in the **Pass/Fail** column for each step. Record any failure in the defect log in `docs/uat/sign-off.md`.

## Automated coverage

Automated coverage of the same derivation (readiness calculation) and debounce logic (celebration display exactly once) is verified in **TEST-050** (`ui/src/hooks/useGoalCrossing.test.ts`). This runbook covers the human UX pass: verifying that the dashboard, celebration overlay, and navigation surfaces render correctly and respond to user interaction. Per the project's UAT approach, automated gates must pass before this manual UAT step is run. See `pnpm test` to verify TEST-050 passes.

---

## Steps

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | In a browser, navigate to `http://localhost:6051/sign-in`. | The **Sign in** page loads with an **Email** field, a **Password** field, and a **Sign in** button. | |
| 2 | In the **Email** field, type `uat-applicant@asp.dev`. | The email appears in the field. | |
| 3 | In the **Password** field, type `UatApplicant1!`. | The password is masked in the field. | |
| 4 | Click the **Sign in** button. | The page redirects to the TOTP challenge page (`/enrol`). | |
| 4a | Open your authenticator app, get the current 6-digit code for `uat-applicant@asp.dev`, enter it in the **TOTP code** field, and click **Verify**. | You land on the **Home** page (`/home`), NOT the Experiences page. A readiness ring with a numeric value (e.g., "0") is displayed. The page shows a brand header, "Welcome, [name]" greeting, a hero section with a large "+" tile, the headline "Your portfolio starts empty. It won't stay that way.", and a full-width orange "Add your first experience" CTA button below. | |
| 5 | Scroll down and locate the "Your categories" section. | A section titled "Your categories" is visible below the hero, showing dashed-border cards. Each card displays a category name (e.g., "Employment"), an hour goal (e.g., "0 of 100 hr goal"), or "No hour minimum" if the category has no hour goal. Each card has a "+" button on the right. | |
| 6 | Pick a category with a visible hour goal (e.g., a category showing "0 of 100 hr goal"). Click the "+" button on that category card. | A modal titled **Add Experience** opens, showing the experience form. The form is pre-filtered to the selected category. | |
| 7–13 | Complete the experience form using the steps from `docs/uat/applicant-scenario.md` steps 7–17. For step-specific instructions on **Organization**, **Position**, **Frequency**, **Start Date**, **Hours/Week**, **Weeks**, **Duties Narrative**, **Location**, **Attestations**, and **Contact** fields, refer to the applicant scenario guide. Fill in values that total **at or above** the category's hour goal (e.g., if the goal is "100 hr", add an experience with 100+ total hours, such as Hours/Week = 25 and Weeks = 5). | The **Add Experience** button is clickable at the bottom of the form and the form shows no validation errors. | |
| 14 | Click the **Add Experience** button. | The modal closes and you return to the `/home` dashboard. | |
| 15 | On the `/home` dashboard, verify the readiness ring has updated with a new numeric value (likely higher than before, e.g., "25" or higher depending on the experience added). | The readiness ring shows a non-zero value, indicating progress toward portfolio readiness. | |
| 16 | Scroll down and locate the "Your categories" section. Verify the category you just added to now displays a progress bar (filled to some percentage) and the hour count has updated (e.g., "100 of 100 hr goal" or "120 of 100 hr goal"). | The category card shows a filled progress bar and the updated hour count matches the hours you entered. | |
| 17 | Scroll up to the 3-up stats row (Total Hours / Verified / Experiences). Verify that **Total Hours** displays the hours you added (e.g., 100 or 120), **Experiences** shows 1, and **Verified** shows 0 (since the mentor has not verified it yet). | All three stats are updated and accurate. | |
| 18 | If the experience you added brought the category total to or above the goal (e.g., 100+ for a 100-hr goal), a **celebration overlay** should appear on the dashboard. Verify the overlay shows a radial background with confetti, a white check icon in an orange medallion, the text "GOAL REACHED", the category name in a headline (e.g., "You hit your Employment goal!"), and two CTAs: "Share progress with my mentor" and "Keep building". | The celebration overlay is visible with all expected elements. | |
| 19 | Click the **Keep building** button to dismiss the celebration. | The overlay closes and you return to the `/home` dashboard view. | |
| 20 | Without adding any new experiences, refresh the page (`F5` or Cmd+R). | The page reloads and lands on the `/home` dashboard. **The celebration overlay does NOT re-appear**, confirming the debounce is working correctly (no re-firing on reload). | |
| 21 | At the bottom of the screen, locate the **BottomTabBar** with four tabs: **Home** (house icon), **Categories** (folder icon), **Mentor** (person icon), and **Profile** (person-circle icon). | All four tabs are visible and **Home** is highlighted as the active tab. | |
| 22 | Click the **Categories** tab. | The page navigates to `/experiences` showing the category tab bar and experiences list. The **Categories** tab in the bottom bar is now highlighted. | |
| 23 | Click the **Mentor** tab. | The page navigates to `/mentor-status` showing mentor-grant status or the "Request a mentor" form. The **Mentor** tab in the bottom bar is now highlighted. | |
| 24 | Click the **Profile** tab. | The page navigates to `/profile` showing a read-only profile view with: a circular avatar disc (beige/tan background with white initials derived from your name or email), your full name (e.g., "UAT Applicant"), your email (e.g., "uat-applicant@asp.dev"), and role chip(s) showing your role (e.g., "Applicant"). | |
| 25 | Click the **Home** tab to return to the dashboard. | The page navigates back to `/home`. The **Home** tab in the bottom bar is highlighted. The dashboard shows the same experience and stats as before, with no unwanted re-rendering or state loss. | |

---

## Result

- **Overall Pass/Fail:** ______
- **Tester:** ______________________
- **Date:** ______________________
- **Notes / defects raised:** ______________________

Record defects in `docs/uat/sign-off.md`.
