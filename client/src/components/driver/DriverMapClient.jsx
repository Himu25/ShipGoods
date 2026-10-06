"use client";

import dynamic from "next/dynamic";

const DriverMap = dynamic(() => import("@/components/driver/DriverMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100vh-var(--nav-height))] items-center justify-center bg-slate-100 text-slate-500">
      Loading map…
    </div>
  ),
});

export default function DriverMapClient({ booking, token }) {
  return <DriverMap booking={booking} token={token} />;
}
