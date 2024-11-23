import Bookings from "@/components/Bookings";
import { cookies } from "next/headers";

export default async function Page() {
  const cookieStore = cookies();
  const token = cookieStore.get("token");

  const fetchBookingDetails = async () => {
    const res = await fetch(`http://localhost:3000/api/bookings`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token?.value}`,
      },
    });

    if (!res.ok) {
      throw new Error("Failed to fetch booking details");
    }

    return res.json();
  };

  let bookingDetails;
  try {
    bookingDetails = await fetchBookingDetails();
    console.log("🚀 ~ Page ~ bookingDetails:", bookingDetails);
  } catch (error) {
    console.error(error);
    return <div>Error fetching booking details.</div>;
  }

  return (
    <>
      <Bookings bookings={bookingDetails} />
    </>
  );
}
