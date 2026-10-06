import DriverMapClient from "@/components/driver/DriverMapClient";
import { cookies } from "next/headers";

export default async function Page({ params }) {
  const { bookingId } = params;
  const cookieStore = cookies();
  const token = cookieStore.get("token")?.value;

  const fetchBookingDetails = async (token) => {
    const res = await fetch(`http://localhost:3000/api/booking/${bookingId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error("Failed to fetch booking details");
    }

    return res.json();
  };

  let bookingDetails;
  try {
    bookingDetails = await fetchBookingDetails(token);
  } catch (error) {
    console.error(error);
    return <div>Error fetching booking details.</div>;
  }

  return <DriverMapClient booking={bookingDetails.booking} token={token} />;
}
