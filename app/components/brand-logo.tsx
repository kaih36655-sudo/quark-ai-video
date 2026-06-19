type BrandLogoProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClasses = {
  sm: {
    wrap: "h-10 w-10 rounded-2xl",
    inner: "h-10 w-10 rounded-2xl text-[13px]",
    ring: "rounded-2xl",
    dot: "right-2 top-2 h-1.5 w-1.5",
  },
  md: {
    wrap: "h-11 w-11 rounded-[1.25rem]",
    inner: "h-11 w-11 rounded-[1.25rem] text-sm",
    ring: "rounded-[1.35rem]",
    dot: "right-2.5 top-2.5 h-1.5 w-1.5",
  },
  lg: {
    wrap: "h-12 w-12 rounded-[1.4rem]",
    inner: "h-12 w-12 rounded-[1.4rem] text-base",
    ring: "rounded-[1.5rem]",
    dot: "right-2.5 top-2.5 h-2 w-2",
  },
};

export function BrandLogo({ size = "md", className = "" }: BrandLogoProps) {
  const classes = sizeClasses[size];
  return (
    <div className={`group relative flex shrink-0 items-center justify-center ${classes.wrap} ${className}`}>
      <div className={`absolute -inset-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 opacity-45 blur-md transition duration-300 group-hover:opacity-70 ${classes.ring} motion-safe:animate-pulse`} />
      <div className={`absolute -inset-[2px] bg-[conic-gradient(from_180deg,#38bdf8,#8b5cf6,#6366f1,#38bdf8)] opacity-70 transition duration-300 group-hover:opacity-95 ${classes.ring} motion-safe:[animation:spin_7s_linear_infinite]`} />
      <div className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 font-black tracking-tight text-white shadow-[0_12px_30px_rgba(99,102,241,0.35)] transition duration-300 group-hover:-rotate-3 group-hover:scale-105 ${classes.inner}`}>
        <span className="relative z-10 drop-shadow-sm">AI</span>
        <span className={`absolute rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)] ${classes.dot}`} />
        <span className="absolute -bottom-4 -left-4 h-8 w-8 rounded-full bg-white/25 blur-sm" />
        <span className="absolute right-1 top-1/2 h-px w-8 -rotate-45 bg-white/35" />
      </div>
    </div>
  );
}
