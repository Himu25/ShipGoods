import "./globals.css";
import Navbar from "@/components/Navbar";
import Providers from "@/store/Provider";
import { Toaster } from "react-hot-toast";
import localFont from "next/font/local";
import { SocketProvider } from "@/context/SocketContext";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata = {
  title: "Create Next App",
  description: "Generated by create next app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <SocketProvider>
            <Toaster />
            <Navbar />
            {children}
          </SocketProvider>
        </Providers>
      </body>
    </html>
  );
}