import { NextResponse } from "next/server";
import { getClientKey, isRateLimited, safeCompare } from "@/lib/pinAuth";

export async function POST(request: Request) {
  try {
    const clientKey = getClientKey(request);
    if (isRateLimited(`LEAVE_LOG_PIN:${clientKey}`)) {
      return NextResponse.json({ valid: false, error: "too_many_attempts" }, { status: 429 });
    }

    const body = (await request.json()) as { pin?: unknown };
    const configuredPin = process.env.LEAVE_LOG_PIN;

    if (
      !configuredPin ||
      !/^\d{6}$/.test(configuredPin) ||
      typeof body.pin !== "string" ||
      !/^\d{6}$/.test(body.pin) ||
      !safeCompare(body.pin, configuredPin)
    ) {
      return NextResponse.json({ valid: false });
    }

    return NextResponse.json({ valid: true });
  } catch {
    return NextResponse.json({ valid: false });
  }
}
