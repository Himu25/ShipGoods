"use client";
import React, { useState } from "react";

const DriverSearchForm = () => {
  const [carSize, setCarSize] = useState("");
  const [goodsWeight, setGoodsWeight] = useState("");
  const [startDestination, setStartDestination] = useState("");
  const [endDestination, setEndDestination] = useState("");

  const handleSearch = () => {
    console.log({
      carSize,
      goodsWeight,
      startDestination,
      endDestination,
    });
  };

  return (
    <div className="max-w-lg mx-auto p-6 mt-6 bg-white rounded-lg shadow-md">
      <h2 className="text-gray-800 text-2xl font-semibold text-center mb-6">
        Transport Your Goods
      </h2>

      {/* Car Size Select */}
      <div className="mb-4">
        <label
          className="block text-gray-700 font-medium mb-2"
          htmlFor="carSize"
        >
          Car Size
        </label>
        <select
          id="carSize"
          className="w-full p-3 border border-gray-300 rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={carSize}
          onChange={(e) => setCarSize(e.target.value)}
        >
          <option value="" disabled>
            Select car size
          </option>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </div>

      <div className="mb-4">
        <label
          className="block text-gray-700 font-medium mb-2"
          htmlFor="goodsWeight"
        >
          Weight of Goods (kg)
        </label>
        <input
          type="number"
          id="goodsWeight"
          className="w-full p-3 border border-gray-300 rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter weight of goods"
          value={goodsWeight}
          onChange={(e) => setGoodsWeight(e.target.value)}
        />
      </div>
      <div className="mb-4">
        <label
          className="block text-gray-700 font-medium mb-2"
          htmlFor="startDestination"
        >
          Start Destination
        </label>
        <select
          id="startDestination"
          className="w-full p-3 border border-gray-300 rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={startDestination}
          onChange={(e) => setStartDestination(e.target.value)}
        >
          <option value="" disabled>
            Select start destination
          </option>
          <option value="city1">City 1</option>
          <option value="city2">City 2</option>
          <option value="city3">City 3</option>
        </select>
      </div>

      {/* End Destination Select */}
      <div className="mb-4">
        <label
          className="block text-gray-700 font-medium mb-2"
          htmlFor="endDestination"
        >
          End Destination
        </label>
        <select
          id="endDestination"
          className="w-full p-3 border border-gray-300 rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={endDestination}
          onChange={(e) => setEndDestination(e.target.value)}
        >
          <option value="" disabled>
            Select end destination
          </option>
          <option value="city1">City 1</option>
          <option value="city2">City 2</option>
          <option value="city3">City 3</option>
        </select>
      </div>

      <button
        className="w-full bg-blue-600 text-white p-3 rounded-md shadow hover:bg-blue-700 transition duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        onClick={handleSearch}
      >
        Search Drivers
      </button>
    </div>
  );
};

export default DriverSearchForm;
