# UAT Scenario — Admin

**Role:** Admin (system administrator with the `admin` system role)
**Account:** `uat-admin@asp.dev` / `UatAdmin1!` (default seed values — see `docs/uat.md` § Running the seed)
**Goal:** Sign in as the admin and exercise the admin surfaces: create, edit, and deactivate an experience category (and confirm the deactivated category disappears from the applicant tab bar); revoke the UAT mentor grant (and confirm the mentor can no longer reach the applicant's experiences); and find the applicant account via user search.

## Before you begin

- The UAT seed has been run (`pnpm seed:uat`) and both servers are running (`pnpm dev` — API on `http://localhost:6080`, UI on `http://localhost:6081`).
- The seed has provisioned the **admin** account (`uat-admin@asp.dev`), the **mentor** account (`uat-mentor@asp.dev`), the **applicant** account (`uat-applicant@asp.dev`), an **active mentor grant** linking the mentor to the applicant, and one sample experience (`UAT Sample Hospital` / `Volunteer`) owned by the applicant.
- The reference VMCAS experience categories have been seeded (`pnpm seed:prod`, run before `pnpm seed:uat`). At least one active category exists.
- TOTP has been set up for all three accounts (`pnpm uat:setup`) and the secrets are enrolled in your authenticator app. See `docs/uat.md` § Setting up TOTP for each role.
- Each sign-in requires a TOTP code. After submitting email + password the app redirects to the TOTP challenge page (`/enrol`); open your authenticator app, get the current 6-digit code for that account, enter it, and click **Verify** to complete sign-in.

### Multi-window workflow

This scenario requires acting as **three different users** (admin, applicant, mentor). The cleanest approach is to open **separate browser windows**:

- **Admin window** — a normal browser window or profile, signed in as `uat-admin@asp.dev`. This is your primary window for the whole scenario.
- **Applicant window** — a separate **incognito / private window** (or a second browser profile), signed in as `uat-applicant@asp.dev`. Used in Part B to confirm the deactivated category is gone.
- **Mentor window** — another **incognito / private window** (or a third profile), signed in as `uat-mentor@asp.dev`. Used in Part D to confirm the revoked grant blocks access.

Keeping the sessions in separate windows avoids one session overwriting another's cookie. If you prefer, you may instead use a single window and sign out / sign back in between roles.

Fill in the **Pass/Fail** column for each step. Record any failure in the defect log in `docs/uat/sign-off.md`.

---

## Part A — Admin: category lifecycle (create, edit, deactivate)

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | In the **admin window**, navigate to `http://localhost:6081/sign-in`. | The **Sign in** page loads with an **Email** field, a **Password** field, and a **Sign in** button. | |
| 2 | In the **Email** field, type `uat-admin@asp.dev`. | The email appears in the field. | |
| 3 | In the **Password** field, type `UatAdmin1!`. | The password is masked in the field. | |
| 4 | Click the **Sign in** button. | The page redirects to the TOTP challenge page (`/enrol`). | |
| 4a | Open your authenticator app, get the current 6-digit code for `uat-admin@asp.dev`, enter it in the **TOTP code** field, and click **Verify**. | You are signed in and land on the Experiences page. | |
| 5 | Navigate to `http://localhost:6081/admin/categories` (or, from `/admin`, click the **Categories** link in the admin nav bar). | The **Experience Categories** page loads with a table of categories and a **Create** button at the top-right. | |
| 6 | Confirm the seeded VMCAS categories are listed. | At least one category row is shown, each with a **Slug**, **Name**, **Sort Order**, and a **Status** badge reading **Active**. | |
| 7 | Click the **Create** button. | A **New Category** form appears with **Slug**, **Name**, **Sort Order**, and an **Active** checkbox, plus **Cancel** and **Create Category** buttons. | |
| 8 | In the **Slug** field, type `uat-admin-test-category`. | The slug text appears in the field. | |
| 9 | In the **Name** field, type `UAT Admin Test Category`. | The name text appears in the field. | |
| 10 | Click the **Create Category** button. | The form closes and a new row for `UAT Admin Test Category` (slug `uat-admin-test-category`) appears in the table with a **Status** badge reading **Active**. | |
| 11 | In the `UAT Admin Test Category` row, click the **Edit** button. | An inline edit form appears in that row, pre-filled with the category's slug and name. | |
| 12 | Change the **Name** field from `UAT Admin Test Category` to `UAT Admin Test Category (Edited)`, then click the **Save Changes** button. | The edit form closes and the row's **Name** column now reads `UAT Admin Test Category (Edited)`. | |
| 13 | In the `UAT Admin Test Category (Edited)` row, click the **Deactivate** button. | The row's **Status** badge changes from **Active** to **Inactive**. The **Deactivate** button no longer appears for this row (it is already inactive). | |

---

## Part B — Applicant: confirm deactivated category is hidden

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 14 | In the **applicant window** (incognito / private), navigate to `http://localhost:6081/sign-in`. | The **Sign in** page loads. | |
| 15 | Sign in as `uat-applicant@asp.dev` with password `UatApplicant1!`, then click **Sign in**. When redirected to `/enrol`, enter the TOTP code from your authenticator app for the applicant account and click **Verify**. | You land on the applicant's Experiences page with a category tab bar across the top. | |
| 16 | Inspect the category tab bar. | A tab labelled `UAT Admin Test Category (Edited)` is **NOT** present in the tab bar (only active categories are shown to applicants). | |

---

## Part C — Admin: revoke the mentor grant

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 17 | Switch back to the **admin window**. Navigate to `http://localhost:6081/admin/grants` (or click the **Grants** link in the admin nav bar). | The **Mentor Grants** page loads, showing a **Create Grant** form section and an **All Grants** table section. | |
| 18 | In the **All Grants** table, locate the grant whose **Status** is **active** that links the UAT mentor to the UAT applicant. (The seed grant links `uat-mentor@asp.dev` → `uat-applicant@asp.dev`.) | A grant row is shown with **Status** **active** and a **Revoke** button in its **Actions** column. | |
| 19 | In that grant's row, click the **Revoke** button. | The grant's **Status** changes to **revoked** and the **Revoke** button is replaced by a **revoked** badge — no further action is available on that row. | |

---

## Part D — Mentor: confirm revoked grant blocks access

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 20 | In the **mentor window** (incognito / private), navigate to `http://localhost:6081/sign-in`. | The **Sign in** page loads. | |
| 21 | Sign in as `uat-mentor@asp.dev` with password `UatMentor1!`, then click **Sign in**. When redirected to `/enrol`, enter the TOTP code from your authenticator app for the mentor account and click **Verify**. | You land on the mentor's own Experiences page. | |
| 22 | Inspect the top bar for the **View as applicant…** applicant-picker dropdown. | The UAT applicant is **NOT** listed in the **View as applicant…** dropdown (the picker is hidden entirely if the mentor now has no active grants). The mentor can no longer select the applicant. | |
| 23 | Attempt to reach the applicant directly: in the mentor window, navigate to `http://localhost:6081/mentor/<applicant-user-id>/experiences`. (If you do not know the applicant id, this step may be skipped — Step 22 already demonstrates the picker no longer offers the applicant.) | The mentor view is **not** granted: the page does not show the applicant's experiences. You are bounced back to the mentor's own experiences (the scope guard asserts an active grant and finds none). | |

---

## Part E — Admin: find the applicant via user search

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 24 | Switch back to the **admin window**. Confirm you are on `http://localhost:6081/admin/grants`. | The **Mentor Grants** page is shown. | |
| 25 | In the **Create Grant** section under **Applicant**, find the **Search by email** input. Type `uat-applicant` and click the **Search** button (or press Enter). | A results list appears below the search box containing an entry for the applicant account — display name `uat-applicant` with email `uat-applicant@asp.dev`. | |
| 26 | Confirm the applicant entry is the expected account. | The result shows the email `uat-applicant@asp.dev`. (Clicking it would select the applicant for a new grant — selection is not required for this scenario.) | |

---

## Result

- **Overall Pass/Fail:** ______
- **Tester:** ______________________
- **Date:** ______________________
- **Notes / defects raised:** ______________________

Record defects in `docs/uat/sign-off.md`.
