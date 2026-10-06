"use client";
import React, {
  createContext,
  useContext,
  useRef,
  useEffect,
  useState,
} from "react";
import io from "socket.io-client";
import { useDispatch, useSelector } from "react-redux";
import { loadUserFromCookies } from "@/store/authSlice";

export const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);
  const dispatch = useDispatch();
  const { id, role, isLoggedIn, token } = useSelector((state) => state.auth);
  const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

  useEffect(() => {
    dispatch(loadUserFromCookies());
  }, [dispatch]);

  useEffect(() => {
    if (!socketUrl || !token) return undefined;
    // Server verifies this token on connect (socket.io `io.use` middleware)
    // and derives who we are from it — it no longer trusts the plain
    // "registerUser"/"driverConnected" id argument on its own.
    // Transport is websocket-only (see note in DriverDashboard.js) so this
    // never needs load-balancer sticky sessions to keep working.
    const instance = io(socketUrl, {
      transports: ["websocket"],
      auth: { token },
    });
    socketRef.current = instance;
    setSocket(instance);

    instance.on("connect", () => {
      console.info(`Successfully connected to socket at ${socketUrl}`);
    });
    instance.on("disconnect", () => {
      console.info("Successfully disconnected");
    });
    instance.on("error", (err) => {
      console.log("Socket Error:", err.message);
    });

    return () => {
      instance.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [socketUrl, token]);

  useEffect(() => {
    if (!socket || !isLoggedIn || !id) return;
    if (role === "user") {
      socket.emit("registerUser", id);
    } else if (role === "driver") {
      socket.emit("driverConnected", id);
    }
    const onConnect = () => {
      if (role === "user") socket.emit("registerUser", id);
      if (role === "driver") socket.emit("driverConnected", id);
    };
    socket.on("connect", onConnect);
    return () => {
      socket.off("connect", onConnect);
    };
  }, [socket, isLoggedIn, id, role]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
