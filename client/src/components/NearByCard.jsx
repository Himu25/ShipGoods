import React, { useEffect, useState } from "react";
import axios from "axios";
import { useSelector } from "react-redux";
import { useSocket } from "@/context/SocketContext";
import { useRouter } from "next/navigation";
import {
  List,
  Card,
  Avatar,
  Button,
  Typography,
  Spin,
  message,
  Modal,
} from "antd";
import { CarOutlined, LoadingOutlined } from "@ant-design/icons";

const NearByCard = ({
  totalDis,
  totalTime,
  startCoordinates,
  endCoordinates,
  vehicleType,
  srcText,
  destnText,
  isScheduled,
  scheduledTime,
  nearbyDrivers = [],
  loadingDrivers = false,
}) => {
  const [price, setPrice] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [waitingForDriver, setWaitingForDriver] = useState(false);
  const { token, id } = useSelector((state) => state.auth);

  const socket = useSocket();
  const router = useRouter();
  const drivers = nearbyDrivers;
  const loading = loadingDrivers;

  useEffect(() => {
    if (
      startCoordinates &&
      endCoordinates &&
      totalDis &&
      totalTime &&
      vehicleType
    ) {
      fetchPrice();
    }
  }, [startCoordinates, endCoordinates, totalDis, totalTime, vehicleType]);

  const fetchPrice = async () => {
    try {
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/get-price`,
        {
          src: { lat: startCoordinates.lat, lng: startCoordinates.lng },
          dest: { lat: endCoordinates.lat, lng: endCoordinates.lng },
          vehicleType,
          distance: totalDis,
          estimatedTime: totalTime,
        }
      );
      const calculatedPrice = response.data?.data?.price;
      setPrice(calculatedPrice);
    } catch (error) {
      console.error("Error fetching price:", error);
    }
  };

  useEffect(() => {
    if (!socket || !id) return;

    socket.emit("registerUser", id);

    const handleBookingAccepted = ({ bookingId }) => {
      setWaitingForDriver(false);
      setRequesting(false);
      message.success("A driver accepted your request!");
      if (isScheduled) {
        router.push(`/user/bookings`);
      } else {
        router.push(`/user/bookings/${bookingId}`);
      }
    };

    const handleBookingRejected = () => {
      message.warning("A driver declined. Still waiting for others…");
    };

    socket.on("bookingAccepted", handleBookingAccepted);
    socket.on("bookingRejected", handleBookingRejected);

    return () => {
      socket.off("bookingAccepted", handleBookingAccepted);
      socket.off("bookingRejected", handleBookingRejected);
    };
  }, [socket, id, router, isScheduled]);

  const handleRequestToPick = async () => {
    if (requesting || waitingForDriver) return;

    setRequesting(true);
    try {
      const bookingData = {
        distance: totalDis,
        duration: totalTime * 60,
        src: {
          coordinates: [startCoordinates.lat, startCoordinates.lng],
        },
        destn: {
          coordinates: [endCoordinates.lat, endCoordinates.lng],
        },
        price,
        srcText,
        destnText,
        isScheduled,
        scheduledTime,
      };

      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/booking/create`,
        bookingData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const driverIds = drivers.map((driver) => driver._id);
      socket.emit("requestPickup", {
        driverIds,
        bookingData: response.data.booking,
      });

      setWaitingForDriver(true);
      message.success("Request sent — waiting for a driver to accept");
    } catch (error) {
      console.error("Error requesting pickup:", error);
      message.error("Failed to send pickup request.");
      setWaitingForDriver(false);
    } finally {
      setRequesting(false);
    }
  };

  const cancelWaiting = () => {
    setWaitingForDriver(false);
    message.info("You can request again anytime.");
  };

  const isButtonDisabled =
    price === null ||
    drivers.length === 0 ||
    loading ||
    requesting ||
    waitingForDriver;

  const typeLabel = vehicleType
    ? vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1)
    : "Vehicle";

  return (
    <>
      <Card
        title={`Price & Nearby ${typeLabel}s`}
        bordered={false}
        className="shadow-sm border border-slate-100"
        style={{ margin: "0 auto", borderRadius: "14px" }}
      >
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Estimated Price
        </Typography.Title>
        {price !== null ? (
          <Typography.Text
            style={{
              fontSize: "22px",
              color: "#2563eb",
              fontWeight: "bold",
            }}
          >
            ₹ {price}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">
            Calculating price...
          </Typography.Text>
        )}

        <Typography.Title level={5} style={{ marginTop: "20px" }}>
          Nearby {typeLabel}s ({drivers.length})
        </Typography.Title>
        {loading ? (
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <Spin size="large" />
          </div>
        ) : drivers.length > 0 ? (
          <List
            itemLayout="horizontal"
            dataSource={drivers}
            renderItem={(driver) => (
              <List.Item
                actions={[
                  <Typography.Text key="vehicle">
                    <CarOutlined />{" "}
                    {driver.vehicleDetails?.type
                      ? driver.vehicleDetails.type.charAt(0).toUpperCase() +
                        driver.vehicleDetails.type.slice(1)
                      : typeLabel}
                    {driver.vehicleDetails?.model
                      ? ` · ${driver.vehicleDetails.model}`
                      : ""}
                  </Typography.Text>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar size={48} style={{ backgroundColor: "#2563eb" }}>
                      {driver.name.charAt(0)}
                    </Avatar>
                  }
                  title={driver.name}
                  description={`${Number(driver.dist?.calculated ?? 0).toFixed(2)} km away`}
                />
              </List.Item>
            )}
          />
        ) : (
          <Typography.Text type="secondary">
            No {vehicleType}s found nearby.
          </Typography.Text>
        )}

        {waitingForDriver && (
          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 flex items-start gap-3">
            <Spin
              indicator={<LoadingOutlined style={{ fontSize: 20 }} spin />}
            />
            <div>
              <p className="text-sm font-semibold text-blue-800 m-0">
                Requesting nearby drivers…
              </p>
              <p className="text-xs text-blue-600 mt-1 mb-0">
                Sent to {drivers.length} {typeLabel.toLowerCase()}
                {drivers.length === 1 ? "" : "s"}. Waiting for someone to
                accept.
              </p>
            </div>
          </div>
        )}

        <Button
          type="primary"
          block
          size="large"
          style={{ marginTop: "20px", borderRadius: 10, height: 44 }}
          onClick={handleRequestToPick}
          disabled={isButtonDisabled}
          loading={requesting}
        >
          {requesting
            ? "Sending request…"
            : waitingForDriver
              ? "Waiting for driver…"
              : "Request to Pick"}
        </Button>
      </Card>

      <Modal
        open={waitingForDriver}
        footer={null}
        closable={false}
        centered
        maskClosable={false}
        width={360}
      >
        <div className="flex flex-col items-center text-center py-4 px-2">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
            <Spin
              indicator={<LoadingOutlined style={{ fontSize: 28 }} spin />}
            />
          </div>
          <h3 className="text-lg font-bold text-slate-900 m-0">
            Finding a driver
          </h3>
          <p className="mt-2 mb-1 text-sm text-slate-500">
            Your pickup request is being sent to nearby {typeLabel.toLowerCase()}
            s.
          </p>
          <p className="text-xs text-slate-400 mb-5">
            Please wait — you’ll be redirected when someone accepts.
          </p>
          <Button onClick={cancelWaiting}>Cancel waiting</Button>
        </div>
      </Modal>
    </>
  );
};

export default NearByCard;
