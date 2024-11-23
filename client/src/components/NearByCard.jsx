import React, { useEffect, useState } from "react";
import axios from "axios";
import { useSelector } from "react-redux";
import { useSocket } from "@/context/SocketContext";
import { useRouter } from "next/navigation";
import { List, Card, Avatar, Button, Typography, Spin, message } from "antd";
import { CarOutlined } from "@ant-design/icons";

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
}) => {
  const [price, setPrice] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const { token, id } = useSelector((state) => state.auth);

  const socket = useSocket();
  const router = useRouter();

  useEffect(() => {
    if (
      startCoordinates &&
      endCoordinates &&
      totalDis &&
      totalTime &&
      vehicleType
    ) {
      fetchPrice();
      fetchNearbyDrivers();
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

  const fetchNearbyDrivers = async () => {
    setLoading(true);
    try {
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/nearby-drivers`,
        {
          startLocation: {
            latitude: startCoordinates.lat,
            longitude: startCoordinates.lng,
          },
          vehicleType,
        }
      );
      const driversData = response.data;
      setDrivers(driversData);
    } catch (error) {
      console.error("Error fetching nearby drivers:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!socket || !id) return;

    socket.emit("registerUser", id);

    const handleBookingAccepted = ({ bookingId }) => {
      console.log(isScheduled);
      if (isScheduled) {
        router.push(`/user/bookings`);
      } else {
        router.push(`/user/bookings/${bookingId}`);
      }
    };

    const handleBookingRejected = (bookingDetails) => {
      console.log("Booking rejected:", bookingDetails);
    };
    socket.on("bookingAccepted", handleBookingAccepted);
    socket.on("bookingRejected", handleBookingRejected);

    return () => {
      socket.off("bookingAccepted", handleBookingAccepted);
      socket.off("bookingRejected", handleBookingRejected);
    };
  }, [socket, id, router, isScheduled]);

  const handleRequestToPick = async () => {
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

      message.success("Pickup request sent to all drivers successfully!");
    } catch (error) {
      console.error("Error requesting pickup:", error);
      message.error("Failed to send pickup request.");
    }
  };

  const isButtonDisabled = price === null || drivers.length === 0 || loading;

  return (
    <Card
      title="Price & Nearby Drivers"
      bordered={false}
      style={{ margin: "0 auto", borderRadius: "10px" }}
    >
      <Typography.Title level={3}>Estimated Price</Typography.Title>
      {price !== null ? (
        <Typography.Text
          style={{
            fontSize: "18px",
            color: "#1890ff",
            fontWeight: "bold",
          }}
        >
          ₹ {price}
        </Typography.Text>
      ) : (
        <Typography.Text>Calculating price...</Typography.Text>
      )}

      <Typography.Title level={4} style={{ marginTop: "24px" }}>
        Nearby Drivers
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
                    : "Unknown"}
                </Typography.Text>,
              ]}
            >
              <List.Item.Meta
                avatar={
                  <Avatar size={48} style={{ backgroundColor: "#87d068" }}>
                    {driver.name.charAt(0)}
                  </Avatar>
                }
                title={driver.name}
                description={`${driver.dist.calculated.toFixed(2)} km away`}
              />
            </List.Item>
          )}
        />
      ) : (
        <Typography.Text>No drivers found.</Typography.Text>
      )}

      <Button
        type="primary"
        block
        size="large"
        style={{ marginTop: "24px" }}
        onClick={handleRequestToPick}
        disabled={isButtonDisabled}
      >
        Request to Pick
      </Button>
    </Card>
  );
};

export default NearByCard;
