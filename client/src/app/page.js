"use client";

import dynamic from "next/dynamic";

const MapComponent = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100vh-var(--nav-height))] items-center justify-center bg-slate-100 text-slate-500">
      Loading map…
    </div>
  ),
});

export default function Home() {
  return <MapComponent />;
}
