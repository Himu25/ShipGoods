"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { io } from "socket.io-client";

const UserSocket = ({ userId }) => {
  const router = useRouter();

  useEffect(() => {
    const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL);
    socket.emit("registerUser", userId);
    // Listen for bookingAccepted event from the server
    // socket.on("bookingAccepted", ({ bookingId }) => {
    //   // Navigate to the tracking page with the booking ID
    //   router.push(`/user/bookings/${bookingId}`);
    // });

    // Listen for bookingRejected event from the server
    socket.on("bookingRejected", (bookingDetails) => {
      console.log("Booking rejected:", bookingDetails);
      // Handle rejection (show a message, etc.)
    });

    // Clean up the socket connection when the component unmounts
    return () => {
      socket.disconnect();
    };
  }, [userId, router]);

  return null;
};

export default dynamic(() => Promise.resolve(UserSocket), { ssr: false });
