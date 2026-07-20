# UAT Scenario — Mentor

**Role:** Mentor (with an active mentor grant for the UAT applicant)
**Account:** `uat-mentor@asp.dev` / `UatMentor1!` (default seed values — see `docs/uat.md` § Running the seed)
**Goal:** Sign in as the mentor, select the UAT applicant from the applicant picker, browse the applicant's experience list, and verify the PII gate: contact email and phone are hidden while the sample experience has `permissionToContact=false`, then become visible after the applicant enables consent.

## Before you begin

- The UAT seed has been run (`pnpm seed:uat`) and both servers are running (`pnpm dev` — API on `http://localhost:6080`, UI on `http://localhost:6081`).
- The seed has provisioned the mentor account, the UAT applicant account, and an **active mentor grant** linking the mentor to the applicant. It has also created one sample experience owned by the applicant (`UAT Sample Hospital` / `Volunteer`) with `permissionToContact=false` and contact details `Jane Smith`, `jane.smith@uatsample.com`, `+15551234567`.
- TOTP has been set up for both the mentor and the applicant accounts (`pnpm uat:setup`) and the secrets are enrolled in your authenticator app. See `docs/uat.md` § Setting up TOTP for each role.
- Each sign-in requires a TOTP code. After submitting email + password the app redirects to the TOTP challenge page (`/enrol`); open your authenticator app, get the current 6-digit code for that account, enter it, and click **Verify** to complete sign-in.

### Two-window workflow

This scenario requires acting as **two different users**. The cleanest approach is to open **two browser windows side by side**:

- **Mentor window** — a normal browser window or profile, signed in as `uat-mentor@asp.dev`.
- **Applicant window** — a separate **incognito / private window** (or a second browser profile), signed in as `uat-applicant@asp.dev`.

Keeping the sessions in separate windows avoids one session overwriting the other's cookie. If you prefer, you may instead use a single window and sign out / sign back in between the mentor and applicant steps — but two windows make the "reload as mentor and observe the change" step much faster.

Fill in the **Pass/Fail** column for each step. Record any failure in the defect log in `docs/uat/sign-off.md`.

---

## Part A — Mentor: observe PII hidden

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | In the **mentor window**, navigate to `http://localhost:6081/sign-in`. | The **Sign in** page loads with an **Email** field, a **Password** field, and a **Sign in** button. | |
| 2 | In the **Email** field, type `uat-mentor@asp.dev`. | The email appears in the field. | |
| 3 | In the **Password** field, type `UatMentor1!`. | The password is masked in the field. | |
| 4 | Click the **Sign in** button. | The page redirects to the TOTP challenge page (`/enrol`). | |
| 4a | Open your authenticator app, get the current 6-digit code for `uat-mentor@asp.dev`, enter it in the **TOTP code** field, and click **Verify**. | You land on the Experiences page (the mentor's own experiences). A select dropdown labelled **View as applicant…** is visible in the top bar. | |
| 5 | In the top bar, open the **View as applicant…** dropdown. | The dropdown lists the UAT applicant by name (the display name for `uat-applicant@asp.dev`, e.g. `uat-applicant`). | |
| 6 | Select the UAT applicant entry from the **View as applicant…** dropdown. | The page navigates to the mentor view of the applicant. A sticky banner appears at the top reading **Viewing on behalf of \<applicant name\>** with an **Exit mentor mode** button. | |
| 7 | Locate the category tab bar and click the category tab that shows a count of at least 1 (the sample experience lives in the first seeded category). | The category's experience table is shown. A row for `UAT Sample Hospital` / `Volunteer` is present. | |
| 8 | In the `UAT Sample Hospital` row, confirm the read-only columns. | The row shows Organization `UAT Sample Hospital`, Position `Volunteer`, Total Hours `120`, Hrs/Week `10`, Weeks `12`. No **Edit** or **Delete** buttons appear (the grant is read-only). | |
| 9 | In the `UAT Sample Hospital` row, click the **Details** button. | A detail flyout opens on the right titled **Experience Details** with **Location**, **Attestations**, and **Contact** sections. | |
| 10 | In the flyout **Attestations** section, find the **Permission to contact** row. | **Permission to contact** reads **No**. | |
| 11 | In the flyout **Contact** section, inspect the **Email** and **Phone** rows. | **Email** shows `—` and **Phone** shows `—` (the PII is hidden because `permissionToContact=false`). The contact `jane.smith@uatsample.com` and `+15551234567` are **NOT** shown. | |
| 12 | Click the **×** (Close) button at the top-right of the flyout. | The flyout closes and the experience table is shown again. Leave the mentor window on this page. | |

---

## Part B — Applicant: enable consent

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 13 | In the **applicant window** (incognito / private), navigate to `http://localhost:6081/sign-in`. | The **Sign in** page loads. | |
| 14 | Sign in as `uat-applicant@asp.dev` with password `UatApplicant1!`, then click **Sign in**. When redirected to `/enrol`, enter the TOTP code from your authenticator app for the applicant account and click **Verify**. | You land on the applicant's Experiences page. | |
| 15 | Click the category tab containing the `UAT Sample Hospital` experience, then in that row click the **Edit** button. | A modal opens titled **Edit Experience** with the form pre-filled with the experience's values. | |
| 16 | In the **Contact** section of the form, tick the **Permission to contact** checkbox. | The **Permission to contact** checkbox becomes checked. | |
| 17 | Click the **Save Changes** button at the bottom of the form. | The modal closes and you are returned to the experience table with no error shown. | |

---

## Part C — Mentor: observe PII now visible

| Step | Action | Expected result | Pass/Fail |
|------|--------|-----------------|-----------|
| 18 | Switch back to the **mentor window**. Reload the page (browser refresh) so the experience list is re-fetched. | The mentor view reloads. The **Viewing on behalf of \<applicant name\>** banner is still present and the `UAT Sample Hospital` row is still shown. | |
| 19 | In the `UAT Sample Hospital` row, click the **Details** button again. | The detail flyout reopens titled **Experience Details**. | |
| 20 | In the flyout **Attestations** section, find the **Permission to contact** row. | **Permission to contact** now reads **Yes**. | |
| 21 | In the flyout **Contact** section, inspect the **Email** and **Phone** rows. | **Email** now shows `jane.smith@uatsample.com` and **Phone** now shows `+15551234567`. The contact PII is visible because the applicant enabled consent. | |
| 22 | Click the **×** (Close) button to close the flyout, then click **Exit mentor mode** in the top banner. | The flyout closes; clicking **Exit mentor mode** returns you to the mentor's own Experiences page and the **Viewing on behalf of** banner disappears. | |

---

## Result

- **Overall Pass/Fail:** ______
- **Tester:** ______________________
- **Date:** ______________________
- **Notes / defects raised:** ______________________

Record defects in `docs/uat/sign-off.md`.
