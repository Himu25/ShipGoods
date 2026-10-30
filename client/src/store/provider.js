"use client";
import React from "react";
import { Provider } from "react-redux";
import { store } from "./store";
import axios from "axios";
import Cookies from "js-cookie";

// Every axios call to our API carries the login JWT, so no component has
// to remember to add the header.
axios.interceptors.request.use((config) => {
  const token = Cookies.get("token");
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (token && apiBase && String(config.url || "").startsWith(apiBase)) {
    config.headers = config.headers || {};
    if (!config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default function Providers({ children }) {
  return <Provider store={store}>{children}</Provider>;
}
