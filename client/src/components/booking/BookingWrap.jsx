"use client";
import React from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import BookingPage from "./BookingDetails";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY);

const BookingWrap = ({ booking }) => {
  return (
    <Elements stripe={stripePromise}>
      <BookingPage booking={booking} />
    </Elements>
  );
};

export default BookingWrap;
