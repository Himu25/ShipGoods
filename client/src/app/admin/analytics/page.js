import DriverPerformance from "@/components/analysis/analysis";
import VehicleDemandChart from "@/components/analysis/VehicleDemandChart";
import { cookies } from "next/headers";

async function fetchData() {
  const cookieStore = cookies();
  const token = cookieStore.get("token")?.value;

  const response = await fetch(
    "http://localhost:3000/api/admin/driver-performance",
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        cache: "no-store",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  return await response.json();
}

export default async function Page() {
  let data;

  try {
    data = await fetchData();
    console.log("🚀 ~ Page ~ data:", data);
  } catch (error) {
    console.error("Error fetching data:", error);
    data = null;
  }

  return (
    <div className="flex flex-col lg:flex-row lg:space-x-4 w-full p-4">
      <div className="lg:w-2/3 w-full bg-white  ">
        <DriverPerformance performanceData={data} />
      </div>
      <div className="lg:w-1/3 w-full bg-white p-4">
        <VehicleDemandChart />
      </div>
    </div>
  );
}
