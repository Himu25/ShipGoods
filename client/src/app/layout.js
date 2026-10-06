import "./globals.css";
import Navbar from "@/components/Navbar";
import Providers from "@/store/Provider";
import { Toaster } from "react-hot-toast";
import localFont from "next/font/local";
import { SocketProvider } from "@/context/SocketContext";
import IncomingCall from "@/components/voice/IncomingCall";

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
  title: "ShipGoods",
  description: "On-demand logistics platform for goods transportation",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-[var(--background)] text-[var(--foreground)]`}
      >
        <Providers>
          <SocketProvider>
            <Toaster position="top-right" />
            <IncomingCall />
            <Navbar />
            <main className="min-h-[calc(100vh-var(--nav-height))]">
              {children}
            </main>
          </SocketProvider>
        </Providers>
      </body>
    </html>
  );
}
