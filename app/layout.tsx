import "./globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "夸克AI - AI视频与图片生成平台",
  description: "夸克AI，AI视频与图片生成平台",
  icons: {
    icon: [
      { url: "/icon", type: "image/png", sizes: "64x64" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
