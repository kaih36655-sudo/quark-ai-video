"use client";

import { useEffect, useState } from "react";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  disabled: boolean;
  balance: number;
  createdAt: string;
};

export default function AdminClient() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState("");
  const [deltas, setDeltas] = useState<Record<string, string>>({});

  const loadUsers = async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "加载用户失败");
      return;
    }
    setUsers(json.data.users);
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const patchUser = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "操作失败");
      return;
    }
    setMessage("操作成功");
    await loadUsers();
  };

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-6 py-8 text-black">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">管理员后台</h1>
            <p className="text-sm text-gray-500">第1阶段：用户与余额基础管理</p>
          </div>
          <a href="/" className="rounded-full bg-black px-4 py-2 text-sm text-white">返回首页</a>
        </div>
        {message && <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">{message}</div>}
        <div className="overflow-x-auto rounded-3xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">邮箱</th>
                <th className="px-4 py-3">昵称</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3">余额</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">注册时间</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-gray-100">
                  <td className="px-4 py-3">{user.id}</td>
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3">{user.name}</td>
                  <td className="px-4 py-3">{user.role === "admin" ? "管理员" : "用户"}</td>
                  <td className="px-4 py-3">¥{user.balance.toFixed(2)}</td>
                  <td className="px-4 py-3">{user.disabled ? "已禁用" : "正常"}</td>
                  <td className="px-4 py-3">{new Date(user.createdAt).toLocaleString()}</td>
                  <td className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void patchUser(user.id, { disabled: !user.disabled })}
                        className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
                      >
                        {user.disabled ? "启用" : "禁用"}
                      </button>
                      <button
                        onClick={() => void patchUser(user.id, { role: user.role === "admin" ? "user" : "admin" })}
                        className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
                      >
                        {user.role === "admin" ? "取消管理员" : "设为管理员"}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={deltas[user.id] ?? ""}
                        onChange={(event) => setDeltas((prev) => ({ ...prev, [user.id]: event.target.value }))}
                        placeholder="+10 或 -5"
                        className="w-24 rounded-full border border-gray-200 px-3 py-1 text-xs outline-none"
                      />
                      <button
                        onClick={() => {
                          const amount = Number(deltas[user.id]);
                          if (!Number.isFinite(amount) || amount === 0) {
                            setMessage("请输入非 0 金额");
                            return;
                          }
                          void patchUser(user.id, { balanceDelta: amount, reason: "管理员手动调整余额" });
                        }}
                        className="rounded-full bg-black px-3 py-1 text-xs text-white"
                      >
                        调整余额
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-500" colSpan={8}>暂无用户</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
