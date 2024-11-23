import axios from "axios";
import { useState } from "react";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";

export default function AddDriverModal({ onCloseDriverModal }) {
  const { token } = useSelector((state) => state.auth);
  const [loading, setLoading] = useState(false);
  const [driverForm, setDriverForm] = useState({
    name: "",
    email: "",
    licenseNumber: "",
  });

  const onDriverChange = (e) => {
    const { name, value } = e.target;
    setDriverForm({ ...driverForm, [name]: value });
  };

  const closeModal = () => {
    setDriverForm({ name: "", email: "", licenseNumber: "" });
    onCloseDriverModal();
  };

  const addDriver = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/admin/add-drivers`,
        driverForm,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success("Driver added successfully!");
      closeModal();
    } catch (error) {
      console.error(
        "Error adding driver:",
        error.response?.data || error.message
      );
      toast.error("Error adding driver: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div className="bg-white p-6 rounded shadow-lg w-96">
        <h3 className="text-xl mb-4">Add Driver</h3>
        <form onSubmit={addDriver}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Name</label>
            <input
              type="text"
              name="name"
              value={driverForm.name}
              onChange={onDriverChange}
              required
              className="border rounded w-full p-2"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Email</label>
            <input
              type="email"
              name="email"
              value={driverForm.email}
              onChange={onDriverChange}
              required
              className="border rounded w-full p-2"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              License Number
            </label>
            <input
              type="text"
              name="licenseNumber"
              value={driverForm.licenseNumber}
              onChange={onDriverChange}
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
              {loading ? "Adding..." : "Add Driver"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
