import { NextRequest, NextResponse } from "next/server";
import { fetchUsersForDailyDigest, listTodayTasks, recordDailyDigest } from "@/lib/taskService";
import { sendMessage } from "@/lib/telegram";
import { DateTime } from "luxon";

function ensureCronSecret(req: NextRequest) {
  const secret = process.env.VERCEL_CRON_SECRET;
  if (!secret) {
    return;
  }
  const provided = req.headers.get("x-vercel-signature");
  if (provided !== secret) {
    throw new Error("Unauthorized");
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureCronSecret(req);
    const users = await fetchUsersForDailyDigest();

    for (const user of users) {
      const tasks = await listTodayTasks(user.id);
      if (!tasks.length) {
        await sendMessage(user.chatId, "Good morning! You have no tasks for today. ✅");
        await recordDailyDigest(user.id);
        continue;
      }
      const formatted = tasks
        .map((task, index) => {
          const due = DateTime.fromJSDate(task.dueDate)
            .setZone(user.timezone ?? "Asia/Kolkata")
            .toFormat("hh:mm a");
          return `${index + 1}. ${task.title} — ${due}`;
        })
        .join("\n");
      await sendMessage(
        user.chatId,
        `Good morning! Here's your plan for today:\n${formatted}`
      );
      await recordDailyDigest(user.id);
    }

    return NextResponse.json({ ok: true, users: users.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
