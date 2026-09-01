import { NextResponse } from "next/server";
import { cookies } from "next/headers";

function normalizeAdminText(value: string) {
  return value.trim().replace(/[.\s]+$/g, "");
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    const adminEmail = normalizeAdminText(process.env.ADMIN_EMAIL || "iso112011@iso.com").toLowerCase();
    const adminPassword = normalizeAdminText(process.env.ADMIN_PASSWORD || "Love112011");
    const inputEmail = normalizeAdminText(String(email ?? "")).toLowerCase();
    const inputPassword = normalizeAdminText(String(password ?? ""));

    if (!inputEmail || !inputPassword) {
      return NextResponse.json({ ok: false, error: "กรุณากรอกอีเมลและรหัสผ่าน" }, { status: 400 });
    }

    if (inputEmail !== adminEmail || inputPassword !== adminPassword) {
      return NextResponse.json({ ok: false, error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 });
    }

    const cookieStore = await cookies();
    cookieStore.set("admin_session", "authenticated", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" }, { status: 500 });
  }
}
