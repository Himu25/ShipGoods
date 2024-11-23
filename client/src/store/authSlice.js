"use client";
import { createSlice } from "@reduxjs/toolkit";
import Cookies from "js-cookie";

const initialState = {
  isLoggedIn: false,
  role: null,
  token: null,
  name: null,
  id: null,
};
const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    loginSuccess: (state, action) => {
      console.log(action.payload);
      const { token, role, name, id } = action.payload;
      state.isLoggedIn = true;
      state.token = token;
      state.role = role;
      state.name = name;
      state.id = id;

      Cookies.set("token", token);
      Cookies.set("role", role);
      Cookies.set("name", name);
      Cookies.set("id", id);
    },
    logout: (state) => {
      state.isLoggedIn = false;
      state.role = null;
      state.token = null;
      state.name = null;
      state.id = null;

      Cookies.remove("token");
      Cookies.remove("role");
      Cookies.remove("name");
      Cookies.remove("id");
    },
    loadUserFromCookies: (state) => {
      const token = Cookies.get("token");
      const role = Cookies.get("role");
      const name = Cookies.get("name");
      const id = Cookies.get("id");

      if (token && role && name && id) {
        state.isLoggedIn = true;
        state.token = token;
        state.role = role;
        state.name = name;
        state.id = id;
      }
    },
  },
});

export const { loginSuccess, logout, loadUserFromCookies } = authSlice.actions;
export default authSlice.reducer;
