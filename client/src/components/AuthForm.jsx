"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDispatch } from "react-redux";
import { loginSuccess } from "@/store/authSlice";

const AuthForm = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [role, setRole] = useState("user");
  const router = useRouter();
  const dispatch = useDispatch();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prevData) => ({ ...prevData, [name]: value }));
  };

  const handleRoleChange = (e) => {
    setRole(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const url = isLogin
        ? `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/auth/login`
        : `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/auth/signup`;

      const requestData = {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        role: !isLogin ? role : undefined,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error("Something went wrong. Please try again.");
      }

      const data = await response.json();

      if (isLogin) {
        dispatch(loginSuccess(data));
        if (data.role === "admin") {
          router.push("/admin/fleet", { scroll: false });
        } else if (data.role === "driver") {
          router.push("/driver/jobs", { scroll: false });
        } else {
          router.push("/", { scroll: false });
        }
        alert(`Logged in as ${data.name} (${data.role})`);
      } else {
        alert("Signup successful! Please log in.");
        setIsLogin(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    clearData();
  }, [isLogin]);

  const clearData = () => {
    setFormData({
      name: "",
      email: "",
      password: "",
    });
    setRole("user");
  };

  return (
    <div className="max-w-md mx-auto bg-white shadow-lg rounded-lg p-8 mt-10">
      <h2 className="text-2xl font-bold text-center mb-6">
        {isLogin ? "Login" : "Sign Up"}
      </h2>
      {error && <p className="text-red-500 text-center">{error}</p>}
      <form onSubmit={handleSubmit}>
        {!isLogin && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            />
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
          />
        </div>

        {!isLogin && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700">
              Select Role
            </label>
            <select
              value={role}
              onChange={handleRoleChange}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        )}

        <button
          type="submit"
          className={`w-full ${
            loading ? "bg-gray-400" : "bg-blue-600"
          } text-white rounded-md p-2 hover:bg-blue-500 transition`}
          disabled={loading}
        >
          {loading ? "Processing..." : isLogin ? "Login" : "Sign Up"}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button
          onClick={() => setIsLogin((prev) => !prev)}
          className="text-blue-600 hover:underline"
        >
          {isLogin ? "Create an account" : "Already have an account?"}
        </button>
      </div>
    </div>
  );
};

export default AuthForm;
