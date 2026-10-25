'use client';

import Header from '@/components/header';
import DashboardSidebar from '@/components/dashboard/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-black text-foreground font-sans">
      <Header />
      <div className="w-full px-6 lg:px-10 pt-28 pb-16 grid grid-cols-1 lg:grid-cols-[13rem_minmax(0,1fr)] gap-8 lg:gap-10">
        <DashboardSidebar />
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}
