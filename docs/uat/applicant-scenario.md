# UAT Scenario — Applicant

**Role:** Applicant
**Account:** `uat-applicant@asp.dev` / `UatApplicant1!` (default seed values — see `docs/uat.md` § Running the seed)
**Goal:** Sign in as the applicant, create a new experience with all key field clusters, view its detail flyout, edit it, then delete it.

## Before you begin

- The UAT seed has been run (`pnpm seed:uat`) and both servers are running (`pnpm dev` — API on `http://localhost:6080`, UI on `http://localhost:6081`).
- TOTP has been set up for the applicant account (`pnpm uat:setup`) and the secret is enrolled in your authenticator app. See `docs/uat.md` § Setting up TOTP for each role.
- Each sign-in requires a TOTP code. After submitting email + password the app redirects to the TOTP challenge page (`/enrol`); open your authenticator app, get the current 6-digit code for this account, enter it, and click **Verify** to complete sign-in.
Fill in the **Pass/Fail** column for each step. Record any failure in the defect log in `docs/uat/sign-off.md`.

---

## Steps

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | In a browser, navigate to `http://localhost:6081/sign-in`. | The **Sign in** page loads with an **Email** field, a **Password** field, and a **Sign in** button. | |
| 2 | In the **Email** field, type `uat-applicant@asp.dev`. | The email appears in the field. | |
| 3 | In the **Password** field, type `UatApplicant1!`. | The password is masked in the field. | |
| 4 | Click the **Sign in** button. | The page redirects to the TOTP challenge page (`/enrol`). | |
| 4a | Open your authenticator app, get the current 6-digit code for `uat-applicant@asp.dev`, enter it in the **TOTP code** field, and click **Verify**. | You land on the Experiences page. A category tab bar is visible across the top with at least one category tab. | |
| 5 | Click the first category tab in the tab bar. | The category's experience table is shown below the tab bar. The tab is highlighted as the active tab. | |
| 6 | Click the **Add** button (top-right of the table). If this category has no experiences yet, click **Add your first experience** instead. | A modal opens with the title **Add Experience** containing the experience form. | |
| 7 | In the **Organization** field, type `Riverside Animal Clinic`. | The text appears in the **Organization** field. | |
| 8 | In the **Position** field, type `Kennel Assistant`. | The text appears in the **Position** field. | |
| 9 | From the **Frequency** dropdown, select **Temporary**. | **Temporary** is shown as the selected frequency. | |
| 10 | In the **Start Date** field, pick or type `2024-06-01`. | The date `2024-06-01` is shown in the **Start Date** field. | |
| 11 | In the **Hours/Week** field type `10`, and in the **Weeks** field type `12`. | The **Total Hours** field updates to `120` automatically (Hours/Week × Weeks). | |
| 12 | In the **Duties Narrative** editor, type `Cared for boarded animals and assisted veterinary staff.` | The text appears in the editor and the character counter below it updates (showing a value such as `53/8192`). | |
| 13 | In the **Location** section, type `California` in the **State / Province** field and `United States` in the **Country** field. | Both location values appear in their fields. | |
| 14 | In the **Attestations** section, tick the **Volunteer** checkbox. | The **Volunteer** checkbox is checked. | |
| 15 | In the **Contact** section, type `Dana` in **First name**, `Lopez` in **Last name**, `dana.lopez@riverside.example` in **Contact email**, and `+15551230000` in the phone field. | All four contact values appear in their fields. | |
| 16 | In the **Contact** section, tick the **Permission to contact** checkbox. | The **Permission to contact** checkbox is checked. | |
| 17 | Click the **Add Experience** button at the bottom of the form. | The modal closes and a new row for `Riverside Animal Clinic` appears in the experience table. | |
| 18 | In the new row, confirm the **Total Hours** column shows `120`, the **Hrs/Week** column shows `10`, and the **Weeks** column shows `12`. | The row shows Organization `Riverside Animal Clinic`, Position `Kennel Assistant`, Total Hours `120`, Hrs/Week `10`, Weeks `12`. | |
| 19 | In the new row, click the **Details** button. | A detail flyout opens on the right titled **Experience Details**. | |
| 20 | In the flyout, confirm the **Contact** section shows Name `Dana Lopez` and Email `dana.lopez@riverside.example`, and the **Attestations** section shows **Permission to contact: Yes** and **Volunteer: Yes**. | The flyout displays the contact name, contact email, and the expected attestation values. | |
| 21 | Click the **×** (Close) button at the top-right of the flyout. | The flyout closes and the experience table is shown again. | |
| 22 | In the `Riverside Animal Clinic` row, click the **Edit** button. | A modal opens titled **Edit Experience** with the form pre-filled with the experience's values. | |
| 23 | Change the **Organization** field from `Riverside Animal Clinic` to `Riverside Veterinary Hospital`. | The new organization name appears in the **Organization** field. | |
| 24 | Click the **Save Changes** button at the bottom of the form. | The modal closes and the row's Organization column now reads `Riverside Veterinary Hospital`. | |
| 25 | In the `Riverside Veterinary Hospital` row, click the **Delete** button. | The row is removed from the experience table. | |
| 26 | Confirm the `Riverside Veterinary Hospital` row no longer appears in the table. | No row for `Riverside Veterinary Hospital` (or `Riverside Animal Clinic`) is present. | |

---

## Result

- **Overall Pass/Fail:** ______
- **Tester:** ______________________
- **Date:** ______________________
- **Notes / defects raised:** ______________________

Record defects in `docs/uat/sign-off.md`.
