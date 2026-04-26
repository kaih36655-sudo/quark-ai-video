"use client";

import { useEffect, useState } from "react";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  disabled: boolean;
  balance: number;
  authorizedAgentIds?: string[];
  createdAt: string;
};

type ManagedAgent = {
  id: string;
  name: string;
  description: string;
  type: "video" | "image" | "both";
  visibility: "public" | "private";
  enabled: boolean;
  scenePrompt: string;
  characterPrompt: string;
  languagePrompt: string;
  cameraPrompt: string;
  stylePrompt: string;
  negativePrompt: string;
  extraPrompt: string;
};

type PricingConfig = {
  video_4s: number;
  video_8s: number;
  video_12s: number;
  image_1K: number;
  image_2K: number;
  image_4K: number;
};

const emptyAgent: ManagedAgent = {
  id: "",
  name: "",
  description: "",
  type: "both",
  visibility: "public",
  enabled: true,
  scenePrompt: "",
  characterPrompt: "",
  languagePrompt: "",
  cameraPrompt: "",
  stylePrompt: "",
  negativePrompt: "",
  extraPrompt: "",
};

export default function AdminClient() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [message, setMessage] = useState("");
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [editingAgent, setEditingAgent] = useState<ManagedAgent>(emptyAgent);

  const privateAgents = agents.filter((agent) => agent.visibility === "private");

  const loadUsers = async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "加载用户失败");
      return;
    }
    setUsers(json.data.users);
  };

  const loadAgents = async () => {
    const res = await fetch("/api/admin/agents", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "加载智能体失败");
      return;
    }
    setAgents(json.data.agents);
  };

  const loadPricing = async () => {
    const res = await fetch("/api/admin/pricing", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "加载价格失败");
      return;
    }
    setPricing(json.data.pricing);
  };

  useEffect(() => {
    void loadUsers();
    void loadAgents();
    void loadPricing();
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

  const saveAgent = async () => {
    const isEdit = Boolean(editingAgent.id);
    const res = await fetch(isEdit ? `/api/admin/agents/${editingAgent.id}` : "/api/admin/agents", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingAgent),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "保存智能体失败");
      return;
    }
    setEditingAgent(emptyAgent);
    setMessage("智能体已保存");
    await loadAgents();
  };

  const deleteAgent = async (id: string) => {
    const res = await fetch(`/api/admin/agents/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "删除智能体失败");
      return;
    }
    setMessage("智能体已删除");
    await loadAgents();
  };

  const savePricing = async () => {
    if (!pricing) return;
    const res = await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pricing),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "保存价格失败");
      return;
    }
    setPricing(json.data.pricing);
    setMessage("价格已保存");
  };

  const fieldClass = "rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none";

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-6 py-8 text-black">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">管理员后台</h1>
            <p className="text-sm text-gray-500">用户、智能体与价格配置</p>
          </div>
          <a href="/" className="rounded-full bg-black px-4 py-2 text-sm text-white">返回首页</a>
        </div>
        {message && <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">{message}</div>}

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">价格配置</h2>
          {pricing && (
            <div className="grid gap-3 md:grid-cols-6">
              {(Object.keys(pricing) as (keyof PricingConfig)[]).map((key) => (
                <label key={key} className="space-y-1 text-xs text-gray-500">
                  <span>{key}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={pricing[key]}
                    onChange={(event) => setPricing((prev) => prev ? { ...prev, [key]: Number(event.target.value) } : prev)}
                    className={fieldClass}
                  />
                </label>
              ))}
              <button onClick={() => void savePricing()} className="self-end rounded-xl bg-black px-4 py-2 text-sm text-white">保存价格</button>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">智能体管理</h2>
            <button onClick={() => setEditingAgent(emptyAgent)} className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-700">新建</button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <input className={fieldClass} placeholder="名称" value={editingAgent.name} onChange={(e) => setEditingAgent((prev) => ({ ...prev, name: e.target.value }))} />
            <select className={fieldClass} value={editingAgent.type} onChange={(e) => setEditingAgent((prev) => ({ ...prev, type: e.target.value as ManagedAgent["type"] }))}>
              <option value="video">视频</option>
              <option value="image">图片</option>
              <option value="both">全部</option>
            </select>
            <select className={fieldClass} value={editingAgent.visibility} onChange={(e) => setEditingAgent((prev) => ({ ...prev, visibility: e.target.value as ManagedAgent["visibility"] }))}>
              <option value="public">公开</option>
              <option value="private">非公开</option>
            </select>
            <input className={`${fieldClass} md:col-span-3`} placeholder="描述" value={editingAgent.description} onChange={(e) => setEditingAgent((prev) => ({ ...prev, description: e.target.value }))} />
            {(["scenePrompt", "characterPrompt", "languagePrompt", "cameraPrompt", "stylePrompt", "negativePrompt", "extraPrompt"] as const).map((key) => (
              <textarea
                key={key}
                className={`${fieldClass} min-h-20`}
                placeholder={key}
                value={editingAgent[key]}
                onChange={(e) => setEditingAgent((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editingAgent.enabled} onChange={(e) => setEditingAgent((prev) => ({ ...prev, enabled: e.target.checked }))} />
              启用
            </label>
            <button onClick={() => void saveAgent()} className="rounded-xl bg-black px-4 py-2 text-sm text-white">{editingAgent.id ? "保存修改" : "创建智能体"}</button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {agents.map((agent) => (
              <div key={agent.id} className="rounded-2xl border border-gray-200 p-4 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="font-medium">{agent.name}</div>
                  <div className="text-xs text-gray-500">{agent.type} / {agent.visibility} / {agent.enabled ? "启用" : "停用"}</div>
                </div>
                <p className="mb-3 text-xs text-gray-500">{agent.description || "无描述"}</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setEditingAgent(agent)} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">编辑</button>
                  <button onClick={() => void patchAgentQuick(agent.id, { enabled: !agent.enabled })} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">{agent.enabled ? "停用" : "启用"}</button>
                  <button onClick={() => void patchAgentQuick(agent.id, { visibility: agent.visibility === "public" ? "private" : "public" })} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">{agent.visibility === "public" ? "设非公开" : "设公开"}</button>
                  <button onClick={() => void deleteAgent(agent.id)} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">删除</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-x-auto rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="px-5 py-4">
            <h2 className="text-lg font-semibold">用户管理</h2>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">邮箱</th>
                <th className="px-4 py-3">昵称</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3">余额</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">授权智能体</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-gray-100 align-top">
                  <td className="px-4 py-3">{user.id}</td>
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3">{user.name}</td>
                  <td className="px-4 py-3">{user.role === "admin" ? "管理员" : "用户"}</td>
                  <td className="px-4 py-3">¥{user.balance.toFixed(2)}</td>
                  <td className="px-4 py-3">{user.disabled ? "已禁用" : "正常"}</td>
                  <td className="px-4 py-3">
                    <div className="min-w-48 rounded-2xl border border-gray-100 bg-gray-50 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-700">授权 private 智能体</span>
                        <span className="text-[10px] text-gray-400">{(user.authorizedAgentIds ?? []).length} 项</span>
                      </div>
                      <div className="space-y-1.5">
                      {privateAgents.length === 0 ? <span className="text-xs text-gray-400">暂无 private 智能体</span> : privateAgents.map((agent) => {
                        const checked = (user.authorizedAgentIds ?? []).includes(agent.id);
                        return (
                          <label key={agent.id} className="flex items-center gap-2 rounded-xl bg-white px-2 py-1 text-xs text-gray-700">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const current = new Set(user.authorizedAgentIds ?? []);
                                if (checked) current.delete(agent.id);
                                else current.add(agent.id);
                                void patchUser(user.id, { authorizedAgentIds: Array.from(current) });
                              }}
                            />
                            {agent.name}
                          </label>
                        );
                      })}
                      </div>
                      <div className="mt-2 text-[10px] text-gray-400">勾选后该用户前台可见并使用该 private 智能体</div>
                    </div>
                  </td>
                  <td className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => void patchUser(user.id, { disabled: !user.disabled })} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">{user.disabled ? "启用" : "禁用"}</button>
                      <button onClick={() => void patchUser(user.id, { role: user.role === "admin" ? "user" : "admin" })} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">{user.role === "admin" ? "取消管理员" : "设为管理员"}</button>
                    </div>
                    <div className="flex gap-2">
                      <input value={deltas[user.id] ?? ""} onChange={(event) => setDeltas((prev) => ({ ...prev, [user.id]: event.target.value }))} placeholder="+10 或 -5" className="w-24 rounded-full border border-gray-200 px-3 py-1 text-xs outline-none" />
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
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );

  async function patchAgentQuick(id: string, body: Partial<ManagedAgent>) {
    const res = await fetch(`/api/admin/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "操作智能体失败");
      return;
    }
    await loadAgents();
  }
}
