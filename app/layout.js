import "./globals.css";

export const metadata = {
  title: "Emergency Assistant — AidLive",
  description:
    "Live AI first-aid guidance: camera, voice, and step-by-step instructions for an untrained bystander.",
  icons: { icon: "/favicon.svg" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0F172A",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
