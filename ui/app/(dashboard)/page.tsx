import Link from "next/link";
import { Film, Image, Cpu, Zap, ArrowRight, TrendingUp, CheckCircle, Clock, Layers } from "lucide-react";

const stats = [
  { label: "Total Generated", value: "0", sub: "images", icon: <Image size={22} className="text-primary" />, color: "bg-primary/10" },
  { label: "Active Jobs", value: "0", sub: "running", icon: <Clock size={22} className="text-warning" />, color: "bg-warning/10" },
  { label: "Success Rate", value: "—", sub: "avg", icon: <CheckCircle size={22} className="text-success" />, color: "bg-success/10" },
  { label: "Avg Gen Time", value: "—", sub: "per image", icon: <TrendingUp size={22} className="text-secondary" />, color: "bg-secondary/10" },
];

const quickLinks = [
  {
    title: "TikTok Ad Generator",
    desc: "Generate 30-theme commercial ads with Actor, Prop, or Actor+Prop modes",
    href: "/tiktok-ads",
    icon: <Film size={28} className="text-primary" />,
    badge: "Main Feature",
    badgeColor: "badge-info",
  },
  {
    title: "Image Gallery",
    desc: "Browse and manage all generated images, filter by theme and style",
    href: "/gallery",
    icon: <Image size={28} className="text-meta-5" />,
    badge: "Gallery",
    badgeColor: "badge-info",
  },
  {
    title: "GPU & Serverless",
    desc: "Configure vast.ai serverless endpoint and choose GPU tier",
    href: "/serverless",
    icon: <Cpu size={28} className="text-success" />,
    badge: "vast.ai",
    badgeColor: "badge-success",
  },
  {
    title: "Training / LoRA",
    desc: "Fine-tune LoRA adapters for actor identity or product consistency",
    href: "/training",
    icon: <Zap size={28} className="text-warning" />,
    badge: "Advanced",
    badgeColor: "badge-warning",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-title-md font-bold text-black dark:text-white">Dashboard</h1>
        <p className="text-sm text-body mt-1">
          Geovera · Commercial Ad Synthetic Image Generator for TikTok
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-body uppercase tracking-wide">{s.label}</p>
                <h3 className="mt-2 text-title-sm font-bold text-black dark:text-white">{s.value}</h3>
                <p className="text-xs text-body mt-0.5">{s.sub}</p>
              </div>
              <div className={`rounded-lg p-2.5 ${s.color}`}>
                {s.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="text-lg font-semibold text-black dark:text-white mb-4">Quick Actions</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {quickLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="card group flex items-start gap-4 p-5 hover:border-primary transition-colors duration-200"
            >
              <div className="mt-0.5 flex-shrink-0">{item.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-black dark:text-white group-hover:text-primary transition-colors">
                    {item.title}
                  </h3>
                  <span className={item.badgeColor}>{item.badge}</span>
                </div>
                <p className="text-sm text-body leading-relaxed">{item.desc}</p>
              </div>
              <ArrowRight size={16} className="mt-1 flex-shrink-0 text-body group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </Link>
          ))}
        </div>
      </div>

      {/* Getting Started */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Layers size={20} className="text-primary" />
          <h2 className="text-base font-semibold text-black dark:text-white">Getting Started</h2>
        </div>
        <ol className="space-y-3">
          {[
            { step: "1", title: "Configure vast.ai Serverless", desc: "Set your VAST_ENDPOINT_URL and VAST_API_KEY in Settings → GPU & Serverless", href: "/serverless" },
            { step: "2", title: "Choose Generation Mode", desc: "Go to TikTok Ad Generator → select Actor, Prop, or Actor+Prop mode", href: "/tiktok-ads" },
            { step: "3", title: "Upload Reference Image", desc: "Upload actor face image or product image for consistency", href: "/tiktok-ads" },
            { step: "4", title: "Select Themes & Generate", desc: "Pick from 30 ad themes, set color palette, and click Generate", href: "/tiktok-ads" },
          ].map((item) => (
            <li key={item.step} className="flex items-start gap-3">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
                {item.step}
              </span>
              <div>
                <Link href={item.href} className="text-sm font-medium text-black dark:text-white hover:text-primary">
                  {item.title}
                </Link>
                <p className="text-xs text-body mt-0.5">{item.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
