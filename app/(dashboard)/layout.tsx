"use client";
import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { MultiAngleProvider } from "@/context/MultiAngleContext";
import MultiAngleFloatingBar from "@/components/MultiAngleFloatingBar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <MultiAngleProvider>
      <div className="flex h-screen overflow-hidden bg-whiten dark:bg-boxdark-2">
        <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} />

        <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
          <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
          <main className="flex-1 p-4 md:p-6 2xl:p-8">
            {children}
          </main>
        </div>
      </div>

      {/* Floating job status — visible on all pages while generate is running */}
      <MultiAngleFloatingBar />
    </MultiAngleProvider>
  );
}
