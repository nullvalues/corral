/**
 * UAT setup script — provisions all three role sessions in sequence.
 *
 * Run with:
 *   pnpm uat:setup
 *
 * Requires:
 *   - DATABASE_URL set in the environment
 *   - Running API server (API_BASE, default http://localhost:6080)
 *   - Running UI server (BASE_URL, default http://localhost:6081)
 *
 * Outputs three storageState files and three TOTP secret sidecar files in
 * os.tmpdir(). Prints secrets and paths to stdout for operator reference.
 *
 * Order: admin → applicant → mentor
 *   (admin must be provisioned before mentor so the admin storageState is
 *   available for creating the mentor grant)
 */

import { setup as setupAdmin, storageStatePath as adminPath } from './fixtures/adminSession';
import { setup as setupApplicant, storageStatePath as applicantPath } from './fixtures/applicantSession';
import { setup as setupMentor, storageStatePath as mentorPath } from './fixtures/mentorSession';

async function main(): Promise<void> {
  console.log('=== UAT session setup ===\n');

  console.log('--- [1/3] Admin ---');
  await setupAdmin();
  console.log();

  console.log('--- [2/3] Applicant ---');
  await setupApplicant();
  console.log();

  console.log('--- [3/3] Mentor ---');
  await setupMentor();
  console.log();

  console.log('=== Setup complete ===');
  console.log(`  Admin storageState:     ${adminPath}`);
  console.log(`  Applicant storageState: ${applicantPath}`);
  console.log(`  Mentor storageState:    ${mentorPath}`);
}

main().catch((err: unknown) => {
  console.error('UAT setup failed:', err);
  process.exit(1);
});
