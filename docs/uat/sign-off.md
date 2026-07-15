# asp UAT Sign-off

This is the single aggregated check-sheet for asp User Acceptance Testing. It
consolidates the must-pass items from all four scenario documents:

- `docs/uat/applicant-scenario.md`
- `docs/uat/mentor-scenario.md`
- `docs/uat/admin-scenario.md`
- `docs/uat/cross-cutting-scenario.md`

Run each scenario document end-to-end first, then transcribe the result of each
must-pass item below. A completed sign-off — every Critical and High item marked
**PASS** with no Open Critical or High defects in the defect log — constitutes
UAT acceptance.

**Tester:** ___________________
**Date:** ___________________
**Build / commit:** ___________________
**Environment:** ___________________

---

## Must-pass checklist

Complete all items before signing. A FAIL or blank on any Critical or High item
blocks sign-off. The **Ref** column gives the source scenario document and the
step number(s) where the item originates.

| # | Scenario | Severity | Ref | Description | Result (PASS/FAIL/SKIP) |
|---|----------|----------|-----|-------------|-------------------------|
| 1 | Applicant | Critical | `applicant-scenario.md` steps 6–18 | Create an experience with the hours triple (Hours/Week 10 × Weeks 12 → Total Hours 120 auto-calculated); save and assert the new row shows Total Hours 120, Hrs/Week 10, Weeks 12. | |
| 2 | Applicant | High | `applicant-scenario.md` steps 15–20 | Contact PII fields round-trip: enable **Permission to contact**, fill contact name/email/phone, save, open the detail flyout, and assert the Contact section shows `Dana Lopez` / `dana.lopez@riverside.example` and **Permission to contact: Yes**. | |
| 3 | Applicant | High | `applicant-scenario.md` steps 22–24 | Edit an experience: change Organization to `Riverside Veterinary Hospital`, Save Changes, and assert the row's Organization column updates with no page reload. | |
| 4 | Applicant | High | `applicant-scenario.md` steps 25–26 | Delete an experience: click Delete and assert the row is removed from the table and no longer appears. | |
| 5 | Applicant | High | `cross-cutting-scenario.md` Part B step 8 (and `experiences-validation` coverage) | Validation error shown for invalid input without a page reload (e.g. mismatched passwords show an inline "Passwords do not match" error; client-side Zod validation surfaces inline, the page does not reload). | |
| 6 | Mentor | **Critical** | `mentor-scenario.md` Part A steps 9–11 | PII gate — contact fields hidden when `permissionToContact=false`: in the mentor view detail flyout, **Email** and **Phone** show `—`; the real contact email/phone are NOT shown. | |
| 7 | Mentor | **Critical** | `mentor-scenario.md` Part C steps 18–21 | PII gate — contact fields visible after consent enabled: after the applicant ticks **Permission to contact** and saves, the mentor (on reload) sees the real `jane.smith@uatsample.com` / `+15551234567` in the flyout Contact section. | |
| 8 | Admin | High | `admin-scenario.md` Part A steps 7–13, Part B steps 14–16 | Category create, edit, deactivate: create `UAT Admin Test Category`, edit its Name, deactivate it; then confirm in the applicant window the deactivated category is NOT present in the tab bar. | |
| 9 | Admin | **Critical** | `admin-scenario.md` Part C steps 17–19, Part D steps 20–23 | Mentor grant revoke: revoke the UAT mentor grant, then confirm the mentor loses access — the applicant is no longer offered in the **View as applicant…** picker and direct navigation to the mentor view is bounced. | |
| 10 | Cross-cutting | High | `cross-cutting-scenario.md` Part A steps 2–3 | Sign-out and re-authentication: after clearing the session the app redirects to `/sign-in`; re-signing-in succeeds and lands on the Experiences page. | |
| 11 | Cross-cutting | High | `cross-cutting-scenario.md` Part B steps 1–7 | Password reset end-to-end: forgot-password → retrieve reset link via `/api/uat/reset-links` → set new password → sign in with the new password successfully. (Restore the seed password per Part B step 9.) | |
| 12 | Cross-cutting | **Critical** | `cross-cutting-scenario.md` Part C steps 1–2 | RBAC redirect: an applicant navigating to `/admin` is immediately redirected to `/experiences`; no admin UI is shown. | |
| 13 | Cross-cutting | Medium | `cross-cutting-scenario.md` Part D steps 1–3 | Rate-limit 429 message visible: after ≥11 rapid sign-in attempts within the window, the sign-in form shows a "Too Many Requests" (HTTP 429) error instead of the invalid-credentials message. | |

---

## Defect log

Record every failure or anomaly observed during the run. Each defect references
the scenario and step where it was found. Sign-off is blocked while any
Critical or High defect has **Status: Open**.

| ID | Scenario | Step | Description | Severity | Status |
|----|----------|------|-------------|----------|--------|
|    |          |      |             |          |        |

Severity: Critical / High / Medium / Low.
Status: Open / Fixed / Deferred.

---

## Sign-off declaration

I confirm that all Critical and High must-pass items above are marked PASS and no
Critical or High defects in the defect log are Open.

Signature: ___________________ Date: ___________________
