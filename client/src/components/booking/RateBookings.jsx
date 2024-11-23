import React, { useState } from "react";
import { Rate, message } from "antd";

const RatingComponent = ({ bookingId, initialRating }) => {
  const [rating, setRating] = useState(initialRating || 0);

  const handleRatingChange = async (value) => {
    setRating(value);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/booking/${bookingId}/rate`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: value }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to update rating");
      }

      message.success("Rating updated successfully!");
    } catch (error) {
      console.error("Error updating rating:", error);
      message.error("Failed to update the rating.");
    }
  };

  return (
    <div className="rating-container mt-6 flex flex-col items-center">
      <h3 className="text-lg font-medium mb-2">Rate Your Experience</h3>
      <Rate
        className="rating-stars text-yellow-400 text-2xl"
        value={rating}
        onChange={handleRatingChange}
      />
      <p className="text-sm text-gray-500 mt-2">
        Thank you for rating our service!
      </p>
    </div>
  );
};

export default RatingComponent;
