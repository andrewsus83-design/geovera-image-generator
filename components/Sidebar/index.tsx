"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Film,
  Image,
  Cpu,
  Zap,
  Settings,
  BookOpen,
  ChevronDown,
  Sparkles,
  Layers,
  Clapperboard,
  User,
  Users,
  Wand2,
} from "lucide-react";

interface NavItem {
  label: string;
  href?: string;
  icon: React.ReactNode;
  children?: { label: string; href: string }[];
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: <LayoutDashboard size={18} />,
  },
  {
    label: "Image Generator",
    href: "/tiktok-ads",
    icon: <Wand2 size={18} />,
  },
  {
    label: "Multi-Angle Synthetic",
    href: "/multi-angle",
    icon: <Layers size={18} />,
  },
  {
    label: "Image to Video",
    href: "/video",
    icon: <Clapperboard size={18} />,
  },
  {
    label: "Image Gallery",
    href: "/gallery",
    icon: <Image size={18} />,
  },
  {
    label: "GPU & Serverless",
    href: "/serverless",
    icon: <Cpu size={18} />,
  },
  {
    label: "Character Builder",
    href: "/character-builder",
    icon: <User size={18} />,
  },
  {
    label: "Training / LoRA",
    href: "/training",
    icon: <Zap size={18} />,
  },
  {
    label: "Characters",
    href: "/characters",
    icon: <Users size={18} />,
  },
];

export default function Sidebar({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<string | null>(null);

  const isActive = (href?: string) => href && (pathname === href || (href !== "/" && pathname.startsWith(href)));

  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen flex-col bg-black dark:bg-boxdark
          transition-transform duration-300 ease-in-out
          ${open ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0 lg:static lg:z-auto
          w-72`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-strokedark">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-wide">GEOVERA</h1>
            <p className="text-xs text-bodydark">Image Generator</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
          <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-widest text-bodydark2">
            Main Menu
          </p>

          {navItems.map((item) => (
            <div key={item.label}>
              {item.href ? (
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-all
                    ${isActive(item.href)
                      ? "bg-primary text-white"
                      : "text-bodydark1 hover:bg-graydark hover:text-white"
                    }`}
                >
                  {item.icon}
                  {item.label}
                  {(item.label === "Image Generator" || item.label === "Multi-Angle Synthetic" || item.label === "Image to Video") && (
                    <span className="ml-auto rounded-full bg-primary/20 px-1.5 py-0.5 text-xs text-primary">
                      PRO
                    </span>
                  )}
                </Link>
              ) : (
                <button
                  onClick={() => setExpanded(expanded === item.label ? null : item.label)}
                  className="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium text-bodydark1 hover:bg-graydark hover:text-white transition-all"
                >
                  {item.icon}
                  {item.label}
                  <ChevronDown
                    size={14}
                    className={`ml-auto transition-transform ${expanded === item.label ? "rotate-180" : ""}`}
                  />
                </button>
              )}

              {item.children && expanded === item.label && (
                <div className="mt-1 ml-7 space-y-1">
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={() => setOpen(false)}
                      className={`block rounded-sm px-3 py-2 text-xs font-medium transition-all
                        ${isActive(child.href)
                          ? "text-primary"
                          : "text-bodydark hover:text-white"
                        }`}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="pt-4">
            <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-widest text-bodydark2">
              Settings
            </p>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-all
                ${isActive("/settings")
                  ? "bg-primary text-white"
                  : "text-bodydark1 hover:bg-graydark hover:text-white"
                }`}
            >
              <Settings size={18} />
              Settings
            </Link>
            <a
              href="https://github.com/andrewsus83-design/image-generator"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium text-bodydark1 hover:bg-graydark hover:text-white transition-all"
            >
              <BookOpen size={18} />
              Docs
            </a>
          </div>
        </nav>

        {/* Bottom */}
        <div className="border-t border-strokedark px-4 py-4">
          <div className="flex items-center gap-3 rounded-sm bg-graydark px-3 py-2.5">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold">
              G
            </div>
            <div>
              <p className="text-xs font-medium text-white">Modal A100-80GB</p>
              <p className="text-xs text-bodydark">Connected</p>
            </div>
            <div className="ml-auto h-2 w-2 rounded-full bg-success animate-pulse" />
          </div>
        </div>
      </aside>
    </>
  );
}
