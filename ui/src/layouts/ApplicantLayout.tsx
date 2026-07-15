import { Outlet } from 'react-router-dom';
import { BottomTabBar } from '../components/BottomTabBar.js';

export function ApplicantLayout() {
  return (
    <div className="min-h-screen bg-app-bg">
      <div className="mx-auto max-w-[640px] pb-24">
        <Outlet />
      </div>
      <BottomTabBar />
    </div>
  );
}
