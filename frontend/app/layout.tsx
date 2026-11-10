import type { Metadata } from 'next';
import localFont from 'next/font/local';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

const jakartaSans = localFont({
  src: './fonts/plus-jakarta-sans-latin.woff2',
  variable: '--font-jakarta',
  display: 'optional',
  weight: '400 800',
});

const jetbrainsMono = localFont({
  src: './fonts/jetbrains-mono-latin.woff2',
  variable: '--font-jetbrains',
  display: 'optional',
  weight: '500 700',
});

export const metadata: Metadata = {
  title: 'TEDUH Surabaya — Navigasi Pejalan Kaki & Analitik Kenyamanan Termal',
  description:
    'Platform peta kota 3D dan navigasi pejalan kaki berbasis Thermal Comfort Score (TCS), bayangan bangunan, CCTV Dishub, dan analitik iklim mikro Kota Surabaya.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="id"
      className={`${jakartaSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link
          rel="preconnect"
          href="https://tiles.openfreemap.org"
          crossOrigin=""
        />
        <link
          rel="preconnect"
          href="https://api.open-meteo.com"
          crossOrigin=""
        />
      </head>
      <body className="h-dvh w-dvw overflow-hidden bg-[#F4F2EC] text-slate-900 antialiased selection:bg-teal-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
