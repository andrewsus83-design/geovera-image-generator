"use client";
import { Menu, Bell, Moon, Sun } from "lucide-react";
import { useState, useEffect } from "react";

interface HeaderProps {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
}

export default function Header({ sidebarOpen, setSidebarOpen }: HeaderProps) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
      setDark(true);
    }
  }, []);

  const toggleDark = () => {
    if (dark) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    }
    setDark(!dark);
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-stroke bg-white px-4 py-3 dark:border-strokedark dark:bg-boxdark md:px-6">
      {/* Left: hamburger */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="rounded p-1.5 text-bodydark hover:bg-gray dark:hover:bg-meta-4 lg:hidden"
        >
          <Menu size={20} />
        </button>
        <div className="hidden lg:flex flex-col">
          <h2 className="text-sm font-semibold text-black dark:text-white">
            Geovera Ad Generator
          </h2>
          <p className="text-xs text-body">Commercial Image Synthesis Platform</p>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {/* Dark mode */}
        <button
          onClick={toggleDark}
          className="rounded p-2 text-bodydark hover:bg-gray dark:hover:bg-meta-4 transition-colors"
          title={dark ? "Light Mode" : "Dark Mode"}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Notifications */}
        <button className="relative rounded p-2 text-bodydark hover:bg-gray dark:hover:bg-meta-4 transition-colors">
          <Bell size={18} />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />
        </button>

        {/* User */}
        <div className="flex items-center gap-2 rounded-sm border border-stroke px-3 py-1.5 dark:border-strokedark">
          <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold">
            A
          </div>
          <span className="hidden text-sm font-medium text-black dark:text-white sm:block">
            Admin
          </span>
        </div>
      </div>
    </header>
  );
}
