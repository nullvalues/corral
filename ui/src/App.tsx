import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import type { ReactElement } from 'react';
import { SignIn } from './pages/SignIn.js';
import { SignUp } from './pages/SignUp.js';
import { TotpEnrol } from './pages/TotpEnrol.js';
import { TotpChallenge } from './pages/TotpChallenge.js';
import { ForgotPassword } from './pages/ForgotPassword.js';
import { ResetPassword } from './pages/ResetPassword.js';
import { ProtectedLayout } from './layouts/ProtectedLayout.js';
import { AdminLayout } from './layouts/AdminLayout.js';
import { MentorScopeLayout } from './layouts/MentorScopeLayout.js';
import { MentorWorkspaceLayout } from './layouts/MentorWorkspaceLayout.js';
import { MentorDashboardPage } from './pages/MentorDashboardPage.js';
import { ApplicantReviewPage } from './pages/ApplicantReviewPage.js';
import { TalentPoolPage } from './pages/TalentPoolPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { CategoriesAdminPage } from './pages/CategoriesAdminPage.js';
import { GrantsAdminPage } from './pages/GrantsAdminPage.js';
import { UsersAdminPage } from './pages/UsersAdminPage.js';
import { ReadinessSettingsPage } from './pages/ReadinessSettingsPage.js';
import { MilestoneAwardsAdminPage } from './pages/MilestoneAwardsAdminPage.js';
import { FlagsAdminPage } from './pages/FlagsAdminPage.js';
import { AccountSettingsPage } from './pages/AccountSettingsPage.js';
import { ExperiencesPage } from './pages/ExperiencesPage.js';
import { CategoryPage } from './pages/CategoryPage.js';
import { RootRedirect } from './pages/RootRedirect.js';
import { ApplicantLayout } from './layouts/ApplicantLayout.js';
import { HomePage } from './pages/HomePage.js';
import { MentorStatusPage } from './pages/MentorStatusPage.js';
import { ProfilePage } from './pages/ProfilePage.js';

export const router = createBrowserRouter([
  { path: '/sign-up', element: <SignUp /> },
  { path: '/sign-in', element: <SignIn /> },
  { path: '/enrol', element: <TotpEnrol /> },
  { path: '/two-factor', element: <TotpChallenge /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  {
    path: '/',
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <RootRedirect /> },
      { path: 'settings', element: <AccountSettingsPage /> },
      {
        element: <ApplicantLayout />,
        children: [
          { path: 'home', element: <HomePage /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: 'mentor-status', element: <MentorStatusPage /> },
          {
            path: 'experiences',
            element: <ExperiencesPage />,
            children: [{ path: ':slug', element: <CategoryPage /> }],
          },
        ],
      },
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminPage /> },
          { path: 'categories', element: <CategoriesAdminPage /> },
          { path: 'grants', element: <GrantsAdminPage /> },
          { path: 'users', element: <UsersAdminPage /> },
          { path: 'settings', element: <ReadinessSettingsPage /> },
          { path: 'milestone-awards', element: <MilestoneAwardsAdminPage /> },
          { path: 'flags', element: <FlagsAdminPage /> },
        ],
      },
      {
        path: 'mentor',
        element: <MentorWorkspaceLayout />,
        children: [
          { index: true, element: <MentorDashboardPage /> },
          { path: 'talent-pool', element: <TalentPoolPage /> },
          {
            path: ':applicantUserId',
            element: <MentorScopeLayout />,
            children: [
              { index: true, element: <ApplicantReviewPage /> },
              { path: 'experiences', element: <ExperiencesPage /> },
              { path: 'experiences/:slug', element: <CategoryPage /> },
            ],
          },
        ],
      },
    ],
  },
]);

export function App(): ReactElement {
  return <RouterProvider router={router} />;
}
