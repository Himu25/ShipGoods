import Link from "next/link";
import { Card, Tag, Button, Empty } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import moment from "moment";

const BookingCard = ({ booking }) => {
  const formatDateTime = (dateString) =>
    moment(dateString).format("MMMM Do YYYY, h:mm:ss a");

  const capitalize = (status) =>
    status.charAt(0).toUpperCase() + status.slice(1);

  const statusColorMap = {
    pending: "orange",
    accepted: "blue",
    arrived: "cyan",
    collected: "geekblue",
    completed: "green",
    cancelled: "red",
  };

  return (
    <div className="p-1">
      <Card
        title={
          <div className="flex justify-between items-center gap-2 flex-wrap">
            <div className="flex items-center min-w-0">
              <h2 className="text-base font-semibold truncate">
                {booking.srcText || "Pickup"}
              </h2>
              <ArrowRightOutlined className="mx-2 text-gray-500 shrink-0" />
              <h2 className="text-base font-semibold truncate">
                {booking.destnText || "Drop-off"}
              </h2>
            </div>
            <Tag color={statusColorMap[booking.status] || "default"}>
              {capitalize(booking.status || "pending")}
            </Tag>
          </div>
        }
        className="shadow-md hover:shadow-lg transition-shadow duration-300"
      >
        <div className="text-gray-800 flex flex-row justify-between gap-4">
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
  const list = Array.isArray(bookings)
    ? bookings
    : Array.isArray(bookings?.bookings)
      ? bookings.bookings
      : [];

  return (
    <div className="min-h-[calc(100vh-var(--nav-height))] bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-bold text-slate-900 mb-4">My Bookings</h1>

        {list.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 shadow-sm">
            <Empty
              description={
                <div className="space-y-1">
                  <p className="text-base font-semibold text-slate-800">
                    No bookings yet
                  </p>
                  <p className="text-sm text-slate-500">
                    You haven’t placed any trips. Book a pickup to get started.
                  </p>
                </div>
              }
            >
              <Link href="/">
                <Button type="primary" size="large" className="mt-2">
                  Book a trip
                </Button>
              </Link>
            </Empty>
          </div>
        ) : (
          list.map((booking) => (
            <div key={booking._id} className="mb-2">
              <BookingCard booking={booking} />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default BookingList;
