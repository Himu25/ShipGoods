"use client";

import DriverDashboard from "@/components/driver/DriverDashboard";
import { useParams } from "next/navigation";
import { useSelector } from "react-redux";

export default function LiveDriverPage() {
  const params = useParams();
  const driverId = params?.driverId;
  const { token } = useSelector((state) => state.auth);

  if (!driverId) {
    return (
      <div className="sg-driver-home">
        <p>Missing driver id</p>
      </div>
    );
  }

  return <DriverDashboard driverId={driverId} token={token} />;
}
