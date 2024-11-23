import { Card, Tag, Button } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import moment from "moment";

const BookingCard = ({ booking }) => {
  const formatDateTime = (dateString) =>
    moment(dateString).format("MMMM Do YYYY, h:mm:ss a");

  const capitalize = (status) =>
    status.charAt(0).toUpperCase() + status.slice(1);

  // Define a mapping for status to color
  const statusColorMap = {
    pending: "orange",
    accepted: "blue",
    collected: "geekblue",
    completed: "green",
    cancelled: "red",
  };

  return (
    <div className="p-1">
      <Card
        title={
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <h2 className="text-base font-semibold">{booking.srcText}</h2>
              <ArrowRightOutlined className="mx-2 text-gray-500" />
              <h2 className="text-base font-semibold">{booking.destnText}</h2>
            </div>
            <Tag color={statusColorMap[booking.status] || "default"}>
              {capitalize(booking.status)}
            </Tag>
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
            <p className="text-sm">
              <strong>Created At:</strong> {formatDateTime(booking.createdAt)}
            </p>
          </div>
          <div className="flex mt-auto justify-end">
            <Button href={`/user/bookings/${booking._id}`} type="link">
              Track Booking
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

const BookingList = ({ bookings }) => {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {bookings.map((booking) => (
        <div key={booking._id} className="mb-2">
          <BookingCard booking={booking} />
        </div>
      ))}
    </div>
  );
};

export default BookingList;
