import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'E500 / Control Plane',
  description: 'Telegram 管理任務，Codex 專注交付。E500 的 Telegram → Codex 單一主線控制平面。',
  openGraph: {
    title: 'E500 / Control Plane',
    description: 'Telegram 管理任務，Codex 專注交付。',
    type: 'website',
    images: [{ url: '/og.png', width: 1792, height: 1024, alt: 'E500 / Control Plane' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'E500 / Control Plane',
    description: 'Telegram 管理任務，Codex 專注交付。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
