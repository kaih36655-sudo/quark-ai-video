import { ImageResponse } from "next/og";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 18,
          background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 48%, #0ea5e9 100%)",
          boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.42)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: -12,
            background: "radial-gradient(circle at 78% 20%, rgba(255,255,255,0.55), transparent 24%), radial-gradient(circle at 18% 82%, rgba(255,255,255,0.25), transparent 28%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 14,
            top: 14,
            width: 7,
            height: 7,
            borderRadius: 999,
            background: "#ffffff",
          }}
        />
        <div
          style={{
            color: "#ffffff",
            fontSize: 26,
            fontWeight: 900,
            letterSpacing: 0,
            lineHeight: 1,
            textShadow: "0 3px 12px rgba(30,41,59,0.22)",
          }}
        >
          AI
        </div>
      </div>
    ),
    size
  );
}
