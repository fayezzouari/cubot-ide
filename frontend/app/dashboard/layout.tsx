'use client';

import DashboardSidebar from '@/components/dashboard/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-page text-ink font-sans">
      <div className="w-full grid grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <DashboardSidebar />
        <div className="min-w-0 px-6 lg:px-12 pt-8 lg:pt-10 pb-16">{children}</div>
      </div>
    </main>
  );
}
