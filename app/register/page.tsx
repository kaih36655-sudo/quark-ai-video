"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#f7f7f8] text-black">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white/80 px-4 py-4 backdrop-blur md:px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black text-sm font-bold text-white">
            QK
          </div>
          <div>
            <div className="text-base font-semibold md:text-lg">夸克AI视频</div>
            <div className="text-xs text-gray-500">批量视频生成 Agent</div>
          </div>
        </Link>

        <Link
          href="/"
          className="rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700"
        >
          返回首页
        </Link>
      </div>

      <div className="flex min-h-[calc(100vh-73px)] items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black text-sm font-bold text-white">
              QK
            </div>
            <div>
              <h2 className="text-2xl font-semibold">注册</h2>
              <p className="text-sm text-gray-500">创建账号后即可开始生成任务</p>
            </div>
          </div>

          <div className="space-y-3">
            <input
              placeholder="手机号 / 邮箱"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none placeholder:text-gray-400"
            />

            <input
              placeholder="设置密码"
              type="password"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none placeholder:text-gray-400"
            />

            <input
              placeholder="确认密码"
              type="password"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none placeholder:text-gray-400"
            />
          </div>

          <button
            onClick={() => router.push("/login")}
            className="mt-5 w-full rounded-xl bg-black py-3 text-sm font-medium text-white"
          >
            注册
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