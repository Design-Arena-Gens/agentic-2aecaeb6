import { NextRequest, NextResponse } from "next/server";
import { fetchDueReminders, fetchUpcomingPreReminders, markReminderSent } from "@/lib/taskService";
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

    const [dueTasks, preTasks] = await Promise.all([fetchDueReminders(), fetchUpcomingPreReminders()]);

    for (const task of preTasks) {
      const due = DateTime.fromJSDate(task.dueDate).setZone("Asia/Kolkata").toFormat("dd LLL, hh:mm a");
      await sendMessage(task.user.chatId, `⏰ Reminder soon: ${task.title} at ${due}`);
      await markReminderSent(task.id, "pre");
    }

    for (const task of dueTasks) {
      const due = DateTime.fromJSDate(task.dueDate).setZone("Asia/Kolkata").toFormat("dd LLL, hh:mm a");
      await sendMessage(task.user.chatId, `⏰ Time now: ${task.title} (${due})`);
      await markReminderSent(task.id, "due");
    }

    return NextResponse.json({ ok: true, sent: dueTasks.length + preTasks.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
