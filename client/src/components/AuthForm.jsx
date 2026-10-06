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
  const [signupSuccess, setSignupSuccess] = useState(false);

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
      } else {
        setIsLogin(true);
        setSignupSuccess(true);
        setError("");
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
    <div className="flex min-h-[calc(100vh-var(--nav-height))] items-center justify-center px-4 py-10 bg-slate-50">
      <div className="w-full max-w-md bg-white shadow-lg rounded-xl p-8 border border-slate-100">
        <div className="mb-6 text-center">
          <p className="text-sm font-medium text-blue-600 mb-1">ShipGoods</p>
          <h2 className="text-2xl font-bold text-slate-900">
            {isLogin ? "Welcome back" : "Create your account"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {isLogin
              ? "Sign in to book or manage deliveries"
              : "Join as a user or admin to get started"}
          </p>
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">
            {error}
          </p>
        )}

        {signupSuccess && isLogin && (
          <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-700">
            Account created. Please log in.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-slate-700">
                Name
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="mt-1 block w-full border border-slate-300 rounded-lg shadow-sm p-2.5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              className="mt-1 block w-full border border-slate-300 rounded-lg shadow-sm p-2.5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              className="mt-1 block w-full border border-slate-300 rounded-lg shadow-sm p-2.5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-slate-700">
                Select Role
              </label>
              <select
                value={role}
                onChange={handleRoleChange}
                className="mt-1 block w-full border border-slate-300 rounded-lg shadow-sm p-2.5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            className={`w-full rounded-lg p-2.5 font-semibold text-white transition ${
              loading ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500"
            }`}
            disabled={loading}
          >
            {loading ? "Processing..." : isLogin ? "Login" : "Sign Up"}
          </button>
        </form>

        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => {
              setIsLogin((prev) => !prev);
              setError("");
              setSignupSuccess(false);
            }}
            className="text-blue-600 hover:underline text-sm"
          >
            {isLogin ? "Create an account" : "Already have an account?"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthForm;
