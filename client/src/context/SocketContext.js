// "use client";
// // import React, { createContext, useContext, useEffect, useRef } from "react";
// // import { io } from "socket.io-client";
// // import { useSelector } from "react-redux";
// // import { useRouter } from "next/navigation";

// // const SocketContext = createContext();

// // export const SocketProvider = ({ children }) => {
// //   const socketRef = useRef(null);
// //   const router = useRouter();
// //   const { id, role } = useSelector((state) => state.auth);

// //   useEffect(() => {
// //     if (typeof window !== "undefined"     && id && role === "user") {
// //       socketRef.current = io(
// //         process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3000"
// //       );
// //       const socket = socketRef.current;

// //       socket.emit("registerUser", id);

// //       socket.on("bookingAccepted", ({ bookingId }) => {
// //         router.push(`/user/bookings/${bookingId}`);
// //       });

// //       socket.on("bookingRejected", (bookingDetails) => {
// //         console.log("Booking rejected:", bookingDetails);
// //       });

// //       return () => {
// //         socket.disconnect();
// //       };
// //     }
// //   }, [id, role, router]);

// //   const emitEvent = (event, data) => {
// //     if (socketRef.current) {
// //       socketRef.current.emit(event, data);
// //     }
// //   };

// //   const onEvent = (event, callback) => {
// //     if (socketRef.current) {
// //       socketRef.current.on(event, callback);
// //     }
// //   };

// //   return (
// //     <SocketContext.Provider value={{ emitEvent, onEvent }}>
// //       {children}
// //     </SocketContext.Provider>
// //   );
// // };

// // export const useSocket = () => {
// //   return useContext(SocketContext);
// // };

// import React, {
//   createContext,
//   useContext,
//   useEffect,
//   useRef,
//   useState,
// } from "react";
// import io from "socket.io-client";

// // Create a context for the socket
// const SocketContext = createContext(null);

// // Create a provider component to wrap around the app
// export const SocketProvider = ({ children }) => {
//   const [isConnected, setConnected] = useState(false);
//   const socket = useRef(null);

//   useEffect(() => {
//     // Initialize the socket connection
//     socket.current = io(process.env.NEXT_PUBLIC_SOCKET_URL);

//     socket.current.on("connect", () => {
//       console.log("Connected to socket");
//       setConnected(true);
//     });

//     socket.current.on("disconnect", () => {
//       console.log("Disconnected from socket");
//       setConnected(false);
//     });

//     // Cleanup on unmount
//     return () => {
//       if (socket.current) {
//         socket.current.disconnect();
//       }
//     };
//   }, []);

//   return (
//     <SocketContext.Provider value={{ socket: socket.current, isConnected }}>
//       {children}
//     </SocketContext.Provider>
//   );
// };

// // Create a hook to use the socket in other components
// export const useSocket = () => useContext(SocketContext);
"use client";
import React, {
  createContext,
  useContext,
  useRef,
  useEffect,
  useState,
} from "react";

import io from "socket.io-client";

export const SocketContext = createContext();

export const SocketProvider = ({ children, store }) => {
  const [isConnected, setConnected] = useState(false);

  const socket = useRef(null);
  const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

  useEffect(() => {
    if (!isConnected) {
      socket.current = io(socketUrl);

      socket.current.on("connect", () => {
        console.info(`Successfully connected to socket at ${socketUrl}`);
        setConnected(true);
      });

      socket.current.on("disconnect", () => {
        console.info(`Successfully disconnected`);
        setConnected(false);
      });

      socket.current.on("error", (err) => {
        console.log("Socket Error:", err.message);
      });
    }

    return () => {
      if (socket.current && socket.current.connected) {
        socket.current.disconnect();
      }
    };
  }, []);

  return (
    <SocketContext.Provider value={socket.current}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
