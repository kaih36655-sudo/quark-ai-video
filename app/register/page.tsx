"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandLogo } from "../components/brand-logo";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (password !== confirmPassword) {
      setMessage("两次密码不一致");
      return;
    }
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "注册失败");
      return;
    }
    router.push("/");
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-indigo-50 text-black">
      <div className="pointer-events-none absolute left-[-8rem] top-[-10rem] h-96 w-96 rounded-full bg-indigo-200/70 blur-3xl" />
      <div className="pointer-events-none absolute right-[-8rem] top-24 h-96 w-96 rounded-full bg-sky-200/70 blur-3xl" />
      <div className="relative z-10 flex items-center justify-between border-b border-white/70 bg-white/70 px-6 py-4 shadow-sm backdrop-blur-xl sm:px-8 lg:px-10">
        <Link href="/" className="flex min-w-0 items-center gap-4">
          <BrandLogo size="sm" />
          <div className="min-w-0 leading-tight">
            <div className="text-base font-semibold leading-tight md:text-lg">夸克AI</div>
            <div className="mt-0.5 text-[11px] leading-snug text-gray-500 md:text-xs">AI视频与图片生成平台</div>
          </div>
        </Link>

        <Link
          href="/"
          className="rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200"
        >
          返回首页
        </Link>
      </div>

      <div className="relative z-10 flex min-h-[calc(100vh-73px)] items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-white/80 bg-white/82 p-6 shadow-[0_24px_80px_rgba(79,70,229,0.16)] backdrop-blur-2xl md:p-8">
          <div className="mb-6 flex items-center gap-4">
            <BrandLogo size="md" />
            <div className="leading-tight">
              <h2 className="text-2xl font-semibold leading-tight">注册夸克AI</h2>
              <p className="mt-1 text-sm leading-snug text-gray-500">欢迎使用夸克AI</p>
            </div>
          </div>

          <div className="space-y-3">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="邮箱"
              className="w-full rounded-2xl border border-indigo-100 bg-slate-50/80 px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(99,102,241,0.12)] placeholder:text-gray-400"
            />

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="昵称（可选）"
              className="w-full rounded-2xl border border-indigo-100 bg-slate-50/80 px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(99,102,241,0.12)] placeholder:text-gray-400"
            />

            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="设置密码"
              type="password"
              className="w-full rounded-2xl border border-indigo-100 bg-slate-50/80 px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(99,102,241,0.12)] placeholder:text-gray-400"
            />

            <input
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="确认密码"
              type="password"
              className="w-full rounded-2xl border border-indigo-100 bg-slate-50/80 px-4 py-3 text-sm outline-none transition focus:border-indigo-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(99,102,241,0.12)] placeholder:text-gray-400"
            />
          </div>
          {message && <div className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{message}</div>}

          <button
            onClick={() => void handleRegister()}
            disabled={loading}
            className="mt-5 w-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-200/80 transition hover:-translate-y-0.5 hover:brightness-105 disabled:opacity-60"
          >
            {loading ? "注册中..." : "注册"}
          </button>

          <div className="mt-5 flex items-center justify-between text-sm">
            <span className="text-gray-500">已经有账号？</span>
            <Link href="/login" className="font-medium underline underline-offset-4">
              去登录
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
