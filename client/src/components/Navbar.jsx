"use client";
import { loadUserFromCookies, logout } from "@/store/authSlice";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  AiOutlineLogout,
  AiOutlineLogin,
  AiOutlineMenu,
  AiOutlineClose,
  AiOutlineHome,
  AiOutlineCalendar,
  AiOutlineCar,
  AiOutlineBarChart,
  AiOutlineDashboard,
} from "react-icons/ai";
import { useRouter, usePathname } from "next/navigation";

export default function Navbar() {
  const dispatch = useDispatch();
  const { isLoggedIn, role, name } = useSelector((state) => state.auth);
  const router = useRouter();
  const currentPath = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    dispatch(loadUserFromCookies());
  }, [dispatch]);

  useEffect(() => {
    setMenuOpen(false);
  }, [currentPath]);

  const handleLogout = () => {
    dispatch(logout());
    router.push("/login");
  };

  const navItems = (() => {
    switch (role) {
      case "user":
        return [
          { href: "/", label: "Book", icon: AiOutlineHome },
          { href: "/user/bookings", label: "My Bookings", icon: AiOutlineCalendar },
        ];
      case "driver":
        return [
          { href: "/driver/jobs", label: "Jobs", icon: AiOutlineDashboard },
          {
            href: "/driver/scheduled-bookings",
            label: "Scheduled",
            icon: AiOutlineCalendar,
          },
        ];
      case "admin":
        return [
          { href: "/admin/fleet", label: "Fleet", icon: AiOutlineCar },
          { href: "/admin/analytics", label: "Analytics", icon: AiOutlineBarChart },
        ];
      default:
        return [];
    }
  })();

  const homeHref = !isLoggedIn
    ? "/login"
    : role === "admin"
      ? "/admin/fleet"
      : role === "driver"
        ? "/driver/jobs"
        : "/";

  const displayName = name?.trim()?.split(" ")[0] || "User";
  const initials = (name || "U")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const NavLinks = ({ mobile = false }) =>
    navItems.map(({ href, label, icon: Icon }) => {
      const active =
        currentPath === href ||
        (href !== "/" && currentPath.startsWith(href));
      return (
        <Link
          key={href}
          href={href}
          className={
            mobile
              ? `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-700 hover:bg-slate-50"
                }`
              : `group relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all ${
                  active
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/25"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
          }
        >
          <Icon className={active && !mobile ? "opacity-95" : "opacity-80"} />
          {label}
        </Link>
      );
    });

  return (
    <nav className="sticky top-0 z-50 h-[var(--nav-height)] border-b border-white/40 bg-white/80 backdrop-blur-xl shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)]">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400" />
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-4 min-w-0">
          <Link href={homeHref} className="group flex items-center gap-2.5 shrink-0">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-lg shadow-blue-500/30 ring-2 ring-white">
              <AiOutlineCar className="text-lg" />
            </span>
            <span className="leading-tight">
              <span className="block text-base font-extrabold tracking-tight text-slate-900 group-hover:text-blue-700 transition">
                ShipGoods
              </span>
              <span className="hidden sm:block text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                Logistics
              </span>
            </span>
          </Link>

          {isLoggedIn && navItems.length > 0 && (
            <div className="hidden sm:flex items-center gap-1 rounded-full bg-slate-100/80 p-1 border border-slate-200/80">
              <NavLinks />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {isLoggedIn ? (
            <>
              <div className="hidden sm:flex items-center gap-2.5 rounded-full border border-slate-200 bg-white pl-1 pr-3 py-1 shadow-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-800 to-slate-600 text-[11px] font-bold text-white">
                  {initials}
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-slate-800 max-w-[100px] truncate">
                    {displayName}
                  </p>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    {role}
                  </p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-100 hover:border-red-200"
              >
                <AiOutlineLogout />
                <span className="hidden sm:inline">Logout</span>
              </button>
              <button
                type="button"
                className="sm:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="Toggle menu"
              >
                {menuOpen ? <AiOutlineClose size={18} /> : <AiOutlineMenu size={18} />}
              </button>
            </>
          ) : (
            currentPath !== "/login" && (
              <Link href="/login">
                <button className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:brightness-105">
                  <AiOutlineLogin />
                  Login
                </button>
              </Link>
            )
          )}
        </div>
      </div>

      {menuOpen && isLoggedIn && (
        <div className="sm:hidden absolute left-3 right-3 top-[calc(var(--nav-height)+6px)] rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xl p-2 shadow-xl shadow-slate-900/10">
          <NavLinks mobile />
        </div>
      )}
    </nav>
  );
}
