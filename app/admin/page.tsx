import { getCurrentUser } from "@/lib/server/auth";
import AdminClient from "./admin-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f8] px-4 text-black">
        <div className="rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="text-2xl font-semibold">403</div>
          <p className="mt-2 text-sm text-gray-500">无管理员权限</p>
          <a href="/" className="mt-5 inline-flex rounded-full bg-black px-4 py-2 text-sm text-white">返回首页</a>
        </div>
      </main>
    );
  }
  return <AdminClient />;
}
