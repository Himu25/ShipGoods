import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-hot-toast";
import { useSelector } from "react-redux";

const EditVehicleModal = ({
  vehicle,
  onCloseEditVehicleModal,
  fetchVehicles,
}) => {
  const { token } = useSelector((state) => state.auth);
  const [formData, setFormData] = useState({
    model: "",
    type: "",
    numberPlate: "",
    driverId: "",
  });
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (vehicle) {
      setFormData({
        model: vehicle.model,
        type: vehicle.type,
        numberPlate: vehicle.numberPlate,
        driverId: vehicle.driverId ? vehicle.driverId._id : "",
      });
    }
    fetchDrivers();
  }, [vehicle]);

  const fetchDrivers = async () => {
    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/admin/drivers`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setDrivers(response.data.drivers);
    } catch (error) {
      console.error("Error fetching drivers:", error.message);
      toast.error("Error fetching drivers");
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.put(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/admin/vehicles/${vehicle._id}`,
        formData,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success("Vehicle updated successfully!");
      onCloseEditVehicleModal();
      fetchVehicles();
    } catch (error) {
      console.error("Error updating vehicle:", error.message);
      toast.error("Error updating vehicle: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div className="bg-white p-6 rounded shadow-lg w-96">
        <h3 className="text-xl mb-4">Edit Vehicle</h3>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Model</label>
            <input
              type="text"
              name="model"
              value={formData.model}
              onChange={handleInputChange}
              required
              className="border rounded w-full p-2"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Type</label>
            <select
              name="type"
              value={formData.type}
              onChange={handleInputChange}
              required
              className="border rounded w-full p-2"
            >
              <option value="">Select Type</option>
              <option value="car">Car</option>
              <option value="truck">Truck</option>
              <option value="bus">Bus</option>
              <option value="motorcycle">Motorcycle</option>
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Number Plate
            </label>
            <input
              type="text"
              name="numberPlate"
              value={formData.numberPlate}
              onChange={handleInputChange}
              required
              className="border rounded w-full p-2"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Driver</label>
            <select
              name="driverId"
              value={formData.driverId}
              onChange={handleInputChange}
              className="border rounded w-full p-2"
            >
              <option value="">Select Driver</option>
              {vehicle.driverId && (
                <option value={vehicle.driverId._id} disabled>
                  Current Driver: {vehicle.driverId.name}
                </option>
              )}
              {drivers.map((driver) => (
                <option key={driver._id} value={driver._id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="mr-2 text-gray-500"
              onClick={onCloseEditVehicleModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 ${
                loading ? "opacity-50 cursor-not-allowed" : ""
              }`}
              disabled={loading}
            >
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditVehicleModal;
