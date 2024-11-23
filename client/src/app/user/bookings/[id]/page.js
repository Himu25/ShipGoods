import { cookies } from "next/headers";
import BookingWrap from "@/components/booking/BookingWrap";

export default async function page({ params }) {
  const { id } = params;
  const cookieStore = cookies();
  const token = cookieStore.get("token");

  const fetchBookingDetails = async () => {
    const res = await fetch(`http://localhost:3000/api/booking/${id}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.value}`,
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
    console.log(bookingDetails);
  } catch (error) {
    console.error(error);
    return <div>Error fetching booking details.</div>;
  }

  return (
    <>
      <BookingWrap booking={bookingDetails.booking} />
    </>
  );
}
