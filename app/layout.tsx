import "./globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "夸克AI视频",
  description: "批量视频生成 Agent",
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