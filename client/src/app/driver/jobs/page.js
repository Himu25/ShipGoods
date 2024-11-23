import DriverDashboard from "@/components/driver/DriverDashboard";
import { cookies } from "next/headers";

export default function page() {
  const cookieStore = cookies();
  const id = cookieStore.get("id");
  const token = cookieStore.get("token");
  return <DriverDashboard driverId={id.value} token={token.value} />;
}
