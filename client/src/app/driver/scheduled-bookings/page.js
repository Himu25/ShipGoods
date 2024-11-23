"use client";
import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import axios from "axios";
import { Card, Button, Spin, message, Tag } from "antd"; // Importing necessary Ant Design components
import { ArrowRightOutlined } from "@ant-design/icons";
import moment from "moment";

export default function Page() {
  const { token, id } = useSelector((state) => state.auth);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchBookings = async () => {
    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/booking/scheduled/${id}`
      );

      setBookings(response.data.bookings);
    } catch (err) {
      setError(err.message || "Error fetching bookings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token && id) {
      fetchBookings();
    }
  }, [token, id]);

  // Cancel booking function
  const cancelBooking = async (bookingId, userId) => {
    try {
      await axios.put(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/booking/update-status/${bookingId}`,
        { status: "cancelled" }
      );
      message.success("Booking cancelled successfully!");
      fetchBookings();
    } catch (error) {
      message.error("Error canceling the booking");
    }
  };

  const formatDateTime = (dateString) =>
    moment(dateString).format("MMMM Do YYYY, h:mm:ss a");

  const canStartBooking = (scheduledTime) => {
    const now = moment();
    const scheduledMoment = moment(scheduledTime);
    return now.isAfter(scheduledMoment);
  };

  if (loading) {
    return (
      <Spin
        size="large"
        className="flex justify-center items-center h-screen"
      />
    );
  }

  if (error) {
    return <div className="text-red-500 text-center">{error}</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {bookings.map((booking) => (
        <div key={booking._id} className="mb-2">
          <Card
            title={
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <h2 className="text-base font-semibold">{booking.srcText}</h2>
                  <ArrowRightOutlined className="mx-2 text-gray-500" />
                  <h2 className="text-base font-semibold">
                    {booking.destnText}
                  </h2>
                </div>
                <div>
                  <Tag color="blue">
                    Scheduled Time: {formatDateTime(booking.scheduledTime)}
                  </Tag>
                </div>
              </div>
            }
            className="shadow-md hover:shadow-lg transition-shadow duration-300"
          >
            <div className="text-gray-800 flex flex-row justify-between">
              <div>
                <p className="mb-0.5 text-sm">
                  <strong>Distance:</strong> {booking.distance} km
                </p>
                <p className="mb-0.5 text-sm">
                  <strong>Duration:</strong> {Math.floor(booking.duration / 60)}{" "}
                  mins
                </p>
                <p className="mb-0.5 text-sm">
                  <strong>Price:</strong>{" "}
                  {booking.price ? `₹${booking.price}` : "Not Available"}
                </p>
              </div>
              <div className="flex mt-auto justify-end">
                <Button
                  type="primary"
                  onClick={() => cancelBooking(booking._id, booking.userId)}
                  className="mr-2"
                >
                  Cancel
                </Button>
                <Button
                  type="default"
                  disabled={!canStartBooking(booking.scheduledTime)}
                  href={`/user/bookings/${booking._id}`}
                >
                  {canStartBooking(booking.scheduledTime)
                    ? "Start"
                    : "Waiting to Start"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}
