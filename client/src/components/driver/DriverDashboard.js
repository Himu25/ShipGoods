"use client";
import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";
import {
  AiOutlineCheckCircle,
  AiOutlineCloseCircle,
  AiOutlineClockCircle,
} from "react-icons/ai";
import { BiArrowToRight } from "react-icons/bi";
import axios from "axios";
import { toast } from "react-hot-toast";
import { useRouter } from "next/navigation";
import { Card, Button, Space, Typography, Spin, Row, Col, Tag } from "antd";

const { Text, Title } = Typography;

const DriverConnection = ({ driverId }) => {
  const [connected, setConnected] = useState(false);
  const [bookings, setBookings] = useState([]);
  const router = useRouter();

  useEffect(() => {
    const socket = io("http://localhost:3000");

    if (driverId) {
      socket.emit("driverConnected", driverId);
      console.log(`Driver with ID ${driverId} connected and registered.`);
      setConnected(true);
    }

    socket.on("pickupRequested", (bookingData) => {
      console.log("New booking request received:", bookingData);
      setBookings((prevBookings) => [...prevBookings, bookingData]);
    });

    return () => {
      socket.disconnect();
    };
  }, [driverId]);

  const acceptBooking = async (bookingDetails) => {
    try {
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/booking/accept`,
        {
          bookingId: bookingDetails._id,
          driverId: driverId,
        }
      );

      console.log("Booking accepted successfully:", response.data.booking);

      const socket = io("http://localhost:3000");
      socket.emit("acceptBooking", {
        driverId,
        bookingId: bookingDetails._id,
        userId: bookingDetails.userId,
      });

      setBookings((prevBookings) =>
        prevBookings.filter((booking) => booking._id !== bookingDetails._id)
      );

      toast.success("Booking accepted successfully!");
      if (!bookingDetails.isScheduled) {
        router.push(`/driver/map/${bookingDetails._id}`);
      }
    } catch (error) {
      console.error("Error accepting the booking:", error);
      toast.error(error.response?.data?.message || "Failed to accept booking.");
    }
  };

  const rejectBooking = (bookingDetails) => {
    const socket = io("http://localhost:3000");
    socket.emit("bookingRejected", {
      driverId,
      bookingId: bookingDetails._id,
    });
    console.log(
      `Booking ${bookingDetails._id} rejected by driver ${driverId}.`
    );
    setBookings((prevBookings) =>
      prevBookings.filter((booking) => booking._id !== bookingDetails._id)
    );

    toast.error("Booking rejected.");
  };

  const formatDuration = (durationInSeconds) => {
    const hours = Math.floor(durationInSeconds / 3600);
    const minutes = Math.floor((durationInSeconds % 3600) / 60);
    const seconds = Math.floor(durationInSeconds % 60);

    return `${hours}h ${minutes}m ${seconds}s`;
  };

  const formatPriceInRupees = (price) => {
    return `₹${price.toFixed(2)}`;
  };

  return (
    <div
      style={{
        padding: "24px",
        backgroundColor: "#f0f2f5",
        minHeight: "100vh",
      }}
    >
      {connected ? (
        <Row gutter={[16, 16]} justify="center">
          {bookings.length > 0 ? (
            bookings.map((booking, index) => (
              <Col key={index} xs={24} sm={12} lg={8}>
                <Card
                  className="booking-card"
                  hoverable
                  style={{
                    borderRadius: "8px",
                    overflow: "hidden",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    height: "100%",
                  }}
                >
                  <div>
                    <Row style={{ marginBottom: "16px", alignItems: "center" }}>
                      <Title level={4} style={{ margin: 0 }}>
                        {booking.userName}
                      </Title>
                      {booking.isScheduled && <Tag color="blue">Scheduled</Tag>}
                    </Row>
                    <Text type="secondary">Pickup:</Text>
                    <p
                      style={{
                        margin: "8px 0",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      {booking.srcText}
                      <BiArrowToRight style={{ margin: "0 10px" }} />
                      {booking.destnText}
                    </p>
                    <Row style={{ marginBottom: "8px" }}>
                      <AiOutlineClockCircle style={{ marginRight: "8px" }} />
                      <Text>{formatDuration(booking.duration)}</Text>
                    </Row>
                    <Row>
                      <Text strong>Distance: {booking.distance} km</Text>
                    </Row>
                    <Row>
                      <Text strong>
                        Price: {formatPriceInRupees(booking.price)}
                      </Text>
                    </Row>
                    {booking.isScheduled && (
                      <Row style={{ marginTop: "8px" }}>
                        <Text type="secondary">
                          Scheduled Time:{" "}
                          {new Date(booking.scheduledTime).toLocaleString()}
                        </Text>
                      </Row>
                    )}
                  </div>
                  <Row
                    justify="space-between"
                    align="middle"
                    style={{ marginTop: "16px" }}
                  >
                    <Space>
                      <Button
                        type="primary"
                        shape="round"
                        icon={<AiOutlineCheckCircle />}
                        onClick={() => acceptBooking(booking)}
                      >
                        Accept
                      </Button>
                      <Button
                        shape="round"
                        danger
                        icon={<AiOutlineCloseCircle />}
                        onClick={() => rejectBooking(booking)}
                      >
                        Reject
                      </Button>
                    </Space>
                  </Row>
                </Card>
              </Col>
            ))
          ) : (
            <Col>
              <div
                style={{
                  textAlign: "center",
                  marginLeft: "auto",
                  marginRight: "auto",
                }}
              >
                <Spin size="large" />
                <Text
                  style={{ display: "block", marginTop: "16px" }}
                  type="secondary"
                >
                  Waiting for new booking requests...
                </Text>
              </div>
            </Col>
          )}
        </Row>
      ) : (
        <div
          style={{
            display: "flex",
            textAlign: "center",
            justifyContent: "center",
            paddingTop: "20%",
          }}
        >
          <Spin size="large" />
          <Text
            style={{ display: "block", marginTop: "16px" }}
            type="secondary"
          >
            Connecting...
          </Text>
        </div>
      )}
    </div>
  );
};

export default DriverConnection;
