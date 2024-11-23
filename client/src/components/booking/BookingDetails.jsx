"use client";

import React, { useState, useEffect } from "react";
import { Steps, Card, Button, Result, Modal, Spin } from "antd";
import { useRouter } from "next/navigation";
import { useSocket } from "@/context/SocketContext";
import { useStripe, useElements, CardElement } from "@stripe/react-stripe-js";
import DriverTracking from "./DriverTracking";
import RatingComponent from "./RateBookings";
import { ClockCircleOutlined } from "@ant-design/icons";
import moment from "moment";

const { Step } = Steps;

const BookingPage = ({ booking }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [currentBooking, setCurrentBooking] = useState(booking);
  const [isPaymentModalVisible, setPaymentModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isPaymentCompleted, setPaymentCompleted] = useState(booking.paymentId);
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const socket = useSocket();

  const steps = [
    { title: "Pending" },
    { title: "Accepted" },
    { title: "Collected" },
    { title: "Completed" },
    { title: "Cancelled" },
  ];

  useEffect(() => {
    const initialStep = steps.findIndex(
      (step) => step.title.toLowerCase() === currentBooking.status.toLowerCase()
    );
    setCurrentStep(initialStep !== -1 ? initialStep : 0);
  }, [currentBooking.status]);

  useEffect(() => {
    if (!socket) return;

    socket.emit("registerUser", booking.userId);

    const handleStatusUpdate = (data) => {
      if (data.bookingId === booking._id) {
        setCurrentBooking((prevBooking) => ({
          ...prevBooking,
          status: data.newStatus,
        }));
      }
    };

    socket.on("statusUpdated", handleStatusUpdate);

    return () => {
      socket.off("statusUpdated", handleStatusUpdate);
    };
  }, [booking._id, socket]);

  const handlePayment = async () => {
    if (!stripe || !elements) {
      return;
    }

    const cardElement = elements.getElement(CardElement);

    if (!cardElement) {
      return;
    }

    setLoading(true);

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/create-payment-intent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: currentBooking.price * 100,
          currency: "INR",
        }),
      }
    );

    const { clientSecret } = await response.json();

    const result = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: {
          name: "Customer Name",
        },
      },
    });

    setLoading(false);

    if (result.error) {
    } else if (result.paymentIntent.status === "succeeded") {
      setPaymentModalVisible(false);
      setPaymentCompleted(true);
      await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/booking/${currentBooking._id}/payment`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId: result.paymentIntent.id }),
        }
      );
    }
  };

  const renderResult = () => {
    if (currentBooking.isScheduled && currentBooking.status === "accepted") {
      return (
        <Result
          className="mt-10"
          status="info"
          title="Booking is not started yet!"
          subTitle={`Scheduled to start on ${moment(
            currentBooking.scheduledTime
          ).format("MMMM Do YYYY, h:mm a")}`}
          icon={
            <ClockCircleOutlined
              style={{ color: "#1890ff", fontSize: "50px" }}
            />
          }
          extra={
            <Button onClick={() => router.push("/")} key="buy">
              Go to Home
            </Button>
          }
        />
      );
    }

    if (currentBooking.status === "cancelled") {
      return (
        <Result
          className="mt-10"
          status="info"
          title="Oh no, the booking has been cancelled!"
          extra={
            <Button onClick={() => router.push("/")} key="buy">
              Book Again
            </Button>
          }
        />
      );
    }

    if (currentBooking.status === "completed") {
      return (
        <Result
          status="success"
          className="mt-10"
          title="Your goods have been delivered successfully!"
          subTitle="Thank you for using our service. We hope to serve you again!"
          extra={[
            <Button
              type="primary"
              onClick={() => setPaymentModalVisible(true)}
              key="pay"
              disabled={isPaymentCompleted}
            >
              {isPaymentCompleted ? "Payment Completed" : "Complete Payment"}
            </Button>,
            <Button onClick={() => router.push("/")} key="buy">
              Book Again
            </Button>,
            <RatingComponent
              bookingId={booking._id}
              initialRating={booking?.rating}
            />,
          ]}
        />
      );
    }

    return null;
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-screen">
      <div className="lg:w-1/3 bg-white p-6 mb-6 lg:mb-0 rounded-none border-r border-gray-300">
        <h1 className="text-2xl font-semibold text-center mb-4">
          Booking Status: {currentBooking.status}
        </h1>

        <Steps direction="vertical" current={currentStep} className="mb-6">
          {steps.map((step, index) => (
            <Step key={index} title={step.title} />
          ))}
        </Steps>

        <Card title="Booking Details" bordered={false} className="mb-4">
          <p>
            <strong>ID:</strong> {currentBooking._id}
          </p>
          <p>
            <strong>Distance:</strong> {currentBooking.distance} km
          </p>
          <p>
            <strong>Duration:</strong> {currentBooking.duration} minutes
          </p>
          <p>
            <strong>Price:</strong> ₹ {currentBooking.price}
          </p>
          <p>
            <strong>Source:</strong> {currentBooking.srcText}
          </p>
          <p>
            <strong>Destination:</strong> {currentBooking.destnText}
          </p>
        </Card>

        {currentBooking.driverId && (
          <Card title="Driver Details" bordered={false}>
            <p>
              <strong>Name:</strong> {currentBooking.driverId.name}
            </p>
            <p>
              <strong>License:</strong> {currentBooking.driverId.licenseNumber}
            </p>
          </Card>
        )}
      </div>

      <div className="lg:w-2/3 bg-white rounded-lg">
        {renderResult() || <DriverTracking booking={booking} />}
      </div>

      <Modal
        title="Complete Payment"
        open={isPaymentModalVisible}
        onCancel={() => setPaymentModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setPaymentModalVisible(false)}>
            Cancel
          </Button>,
          <Button
            key="pay"
            type="primary"
            onClick={handlePayment}
            loading={loading}
            disabled={loading || isPaymentCompleted}
          >
            Pay Now
          </Button>,
        ]}
      >
        <p className="mb-4">Please enter your payment details below:</p>
        <div className="flex flex-row space-x-4">
          <div className="w-full p-2 border rounded-md">
            <CardElement />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default BookingPage;
