import axios from "axios";
import { useState } from "react";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";

const vehicleTypes = ["car", "truck", "bus", "motorcycle"];

export default function AddVehicleModal({
  onCloseVehicleModal,
  fetchVehicles,
}) {
  const { token } = useSelector((state) => state.auth);
  const [loading, setLoading] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({
    model: "",
    type: "",
    numberPlate: "",
  });
  const onVehicleChange = (e) => {
    const { name, value } = e.target;
    setVehicleForm({ ...vehicleForm, [name]: value });
  };
  const closeModal = () => {
    setVehicleForm({ model: "", type: "", numberPlate: "" });
    onCloseVehicleModal();
  };

  const addVehicle = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/admin/add-vehicles`,
        vehicleForm,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success("Vehicle added successfully!");
      closeModal();
      fetchVehicles();
    } catch (error) {
      console.error(
        "Error adding vehicle:",
        error.response?.data || error.message
      );
      toast.error("Error adding vehicle: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div className="bg-white p-6 rounded shadow-lg w-96">
        <h3 className="text-xl mb-4">Add Vehicle</h3>
        <form onSubmit={addVehicle}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Model</label>
            <input
              type="text"
              name="model"
              value={vehicleForm.model}
              onChange={onVehicleChange}
              required
              className="border rounded w-full p-2"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Type</label>
            <select
              name="type"
              value={vehicleForm.type}
              onChange={onVehicleChange}
              className="border rounded w-full p-2"
              required
            >
              <option value="" disabled>
                Select type
              </option>
              {vehicleTypes.map((type) => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Number Plate
            </label>
            <input
              type="text"
              name="numberPlate"
              value={vehicleForm.numberPlate}
              onChange={onVehicleChange}
              required
              className="border rounded w-full p-2"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="mr-2 text-gray-500"
              onClick={closeModal}
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
              {loading ? "Adding..." : "Add Vehicle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
