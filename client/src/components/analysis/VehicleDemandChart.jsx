"use client";
import React, { useState, useEffect } from "react";
import ApexCharts from "react-apexcharts";
import axios from "axios";
import { useSelector } from "react-redux";

const VehicleDemandChart = () => {
  const [vehicleData, setVehicleData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { token } = useSelector((state) => state.auth);

  useEffect(() => {
    const fetchVehicleDemand = async () => {
      try {
        const response = await axios.get(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/admin/vehicle-demand`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        const demandData = response.data.vehicleDemand;
        setVehicleData(demandData);
        setLoading(false);
      } catch (error) {
        setError("Error fetching vehicle demand data");
        setLoading(false);
      }
    };
    if (token) {
      fetchVehicleDemand();
    }
  }, [token]);

  const capitalizeFirstLetter = (string) => {
    return string.charAt(0).toUpperCase() + string.slice(1);
  };

  // Find the best-performing vehicle type, adding a guard for empty vehicleData
  const bestVehicle =
    vehicleData.length > 0
      ? vehicleData.reduce((prev, current) =>
          prev.count > current.count ? prev : current
        )
      : null; // Handle the case when vehicleData is empty

  const categories = vehicleData
    .map((data) => capitalizeFirstLetter(data.type))
    .sort((a, b) =>
      a === bestVehicle?.type ? -1 : b === bestVehicle?.type ? 1 : 0
    ); // Use optional chaining for safety

  const chartOptions = {
    chart: {
      type: "bar",
      height: 350,
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: "55%",
        endingShape: "rounded",
      },
    },
    dataLabels: {
      enabled: false,
    },
    xaxis: {
      categories,
    },
    yaxis: {
      title: {
        text: "Number of Bookings",
      },
    },
    fill: {
      opacity: 1,
    },
  };

  const chartSeries = [
    {
      name: "Bookings",
      data: vehicleData.map((data) => data.count),
    },
  ];

  if (loading) return <div>Loading...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div className="container">
      <h2>Vehicle Demand Chart</h2>
      <ApexCharts
        options={chartOptions}
        series={chartSeries}
        type="bar"
        height={350}
      />
    </div>
  );
};

export default VehicleDemandChart;
