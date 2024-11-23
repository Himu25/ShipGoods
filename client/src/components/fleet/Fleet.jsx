"use client";
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useSelector } from "react-redux";
import { Toaster, toast } from "react-hot-toast";
import { Row, Col, Card, Button, Typography, Spin, Popconfirm } from "antd";
import {
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  CarOutlined,
} from "@ant-design/icons";
import AddDriverModal from "./AddDriver";
import AddVehicleModal from "./AddVehicleModal";
import EditVehicleModal from "./EditVehicleModal";

const { Title, Text } = Typography;

export default function FleetComp() {
  const { token } = useSelector((state) => state.auth);
  const [vehicleModalVisible, setVehicleModalVisible] = useState(false);
  const [editVehicleModalVisible, setEditVehicleModalVisible] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [isAddDriverModalVisible, setIsAddDriverModalVisible] = useState(false);
  const [loadingVehicleId, setLoadingVehicleId] = useState(null);

  const onCloseVehicleModal = () => {
    setVehicleModalVisible(false);
  };

  const onCloseDriverModal = () => {
    setIsAddDriverModalVisible(false);
  };

  const onCloseEditVehicleModal = () => {
    setEditVehicleModalVisible(false);
    setSelectedVehicle(null);
  };

  const fetchVehicles = async () => {
    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/admin/vehicles`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setVehicles(response.data);
    } catch (error) {
      console.error(
        "Error fetching vehicles:",
        error.response?.data || error.message
      );
      toast.error("Error fetching vehicles");
    }
  };

  const handleEditVehicle = (vehicle) => {
    setSelectedVehicle(vehicle);
    setEditVehicleModalVisible(true);
  };

  const handleRemoveDriver = async (vehicleId) => {
    setLoadingVehicleId(vehicleId);
    try {
      await axios.delete(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/admin/vehicles/${vehicleId}/remove-driver`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success("Driver removed successfully");
      fetchVehicles();
    } catch (error) {
      console.error(
        "Error removing driver:",
        error.response?.data || error.message
      );
      toast.error("Error removing driver");
    } finally {
      setLoadingVehicleId(null);
    }
  };

  useEffect(() => {
    if (token) {
      fetchVehicles();
    }
  }, [token]);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <Toaster />
      <header className="flex justify-between items-center mb-6">
        <Title level={2} className="text-gray-800 text-lg">
          Fleet Management
        </Title>
        <div className="flex space-x-4">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsAddDriverModalVisible(true)}
            className="shadow-md hover:shadow-lg transition-all duration-200"
          >
            Add Driver
          </Button>
          <Button
            type="primary"
            icon={<CarOutlined />}
            onClick={() => setVehicleModalVisible(true)}
            className="shadow-md hover:shadow-lg transition-all duration-200"
          >
            Add Vehicle
          </Button>
        </div>
      </header>

      <Row gutter={[16, 16]}>
        {vehicles.length === 0 ? (
          <Col span={24}>
            <Text className="text-gray-600 text-sm">
              No vehicles available.
            </Text>
          </Col>
        ) : (
          vehicles.map((vehicle) => (
            <Col xs={24} sm={12} lg={8} key={vehicle._id}>
              <Card
                hoverable
                title={
                  <div className="flex justify-between items-center">
                    <div>{`${vehicle.model} - ${vehicle.numberPlate}`}</div>
                    <div className="flex space-x-2">
                      <Button
                        icon={<EditOutlined />}
                        size="small"
                        onClick={() => handleEditVehicle(vehicle)}
                      ></Button>
                      {vehicle.driverId && (
                        <Popconfirm
                          title="Are you sure you want to remove this driver?"
                          onConfirm={() => handleRemoveDriver(vehicle._id)}
                          okText="Yes"
                          cancelText="No"
                        >
                          <Button
                            icon={<DeleteOutlined />}
                            danger
                            size="small"
                            loading={loadingVehicleId === vehicle._id}
                          >
                            Remove Driver
                          </Button>
                        </Popconfirm>
                      )}
                    </div>
                  </div>
                }
                bordered={false}
                className="shadow-lg hover:shadow-2xl transition-shadow duration-300"
              >
                <Text strong className="text-sm">
                  Type:{" "}
                </Text>
                <Text className="text-sm">{vehicle.type}</Text>
                <div className="mt-2">
                  <Text strong className="text-sm">
                    Driver:{" "}
                  </Text>
                  <Text className="text-sm">
                    {vehicle.driverId ? vehicle.driverId.name : "Not Assigned"}
                  </Text>
                </div>
              </Card>
            </Col>
          ))
        )}
      </Row>

      {editVehicleModalVisible && (
        <EditVehicleModal
          vehicle={selectedVehicle}
          onCloseEditVehicleModal={onCloseEditVehicleModal}
          fetchVehicles={fetchVehicles}
        />
      )}

      {vehicleModalVisible && (
        <AddVehicleModal
          onCloseVehicleModal={onCloseVehicleModal}
          fetchVehicles={fetchVehicles}
        />
      )}

      {isAddDriverModalVisible && (
        <AddDriverModal onCloseDriverModal={onCloseDriverModal} />
      )}
    </div>
  );
}
