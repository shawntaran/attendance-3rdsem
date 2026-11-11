import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Skip Planner",
  description:
    "Which classes you can skip and which you must attend to keep every course at 75% attendance.",
  applicationName: "Skip Planner",
  appleWebApp: {
    capable: true,
    title: "Skip Planner",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0B5E66",
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
};

// Applies a saved light/dark choice before first paint, so the page does not
// flash the system theme. Reads THEME_KEY from storage.ts, then the pre-cloud
// keys for a device that has not been migrated yet.
const themeScript = `try{var t=localStorage.getItem("skip-planner:theme");if(!t){var o=JSON.parse(localStorage.getItem("skip-planner:v3")||localStorage.getItem("skip-planner:v2")||localStorage.getItem("skip-planner:v1"));t=o&&o.settings.theme}if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
