"use client";
import React from "react";
import { Avatar, Card, Tag, Rate } from "antd";

const DriverPerformance = ({ performanceData }) => {
  return (
    <div className="grid p-5 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mx-auto">
      {performanceData &&
        performanceData?.performanceResults.map((driver) => (
          <Card
            key={driver.driverId}
            title={
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <Avatar className="bg-green-500 mr-2">
                    {driver.name.charAt(0).toUpperCase()}
                  </Avatar>
                  <span>{driver.name}</span>
                </div>
                <Tag color={driver.isAvailable ? "green" : "red"}>
                  {driver.isAvailable ? "Free" : "In Transit"}
                </Tag>
              </div>
            }
            bordered={true}
            className="w-full"
          >
            <p>
              <strong>Vehicle:</strong>{" "}
              {driver.vehicle
                ? `${driver.vehicle.model} - ${driver.vehicle.type}`
                : "Not assigned"}
            </p>
            <p>
              <strong>Performance:</strong> {driver.performanceCategory}
            </p>
            <p>
              <strong>Completed Trips:</strong> {driver.completedTrips}
            </p>
            <strong>Average Rating:</strong>{" "}
            <Rate
              className="mt-1"
              disabled
              allowHalf
              value={driver.averageRating || 0} // Defaults to 0 if no rating is available
            />
          </Card>
        ))}
    </div>
  );
};

export default DriverPerformance;
