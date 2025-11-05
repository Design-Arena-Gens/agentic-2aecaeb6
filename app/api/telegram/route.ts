import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractTasksFromText, interpretNaturalIntent, parseCommand, parseDuration, parseIndex } from "@/lib/nlp";
import { downloadFile, getFile, sendChatAction, sendMessage } from "@/lib/telegram";
import { transcribeAudio } from "@/lib/transcribe";
import { createTasks, formatTask, listOpenTasks, listTodayTasks, logMessage, markTaskDone, snoozeTask, upsertUser } from "@/lib/taskService";
import { DateTime } from "luxon";

const UpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      chat: z.object({
        id: z.union([z.number(), z.string()]),
        type: z.string(),
        first_name: z.string().optional(),
        username: z.string().optional()
      }),
      from: z
        .object({
          id: z.union([z.number(), z.string()]),
          first_name: z.string().optional(),
          username: z.string().optional()
        })
        .optional(),
      text: z.string().optional(),
      voice: z
        .object({
          file_id: z.string(),
          mime_type: z.string().optional(),
          file_size: z.number().optional(),
          duration: z.number().optional()
        })
        .optional(),
      caption: z.string().optional()
    })
    .optional()
});

async function ensureTelegramSecret(req: NextRequest) {
  const secret = process.env.TELEGRAM_BOT_SECRET;
  if (!secret) {
    return;
  }
  const header = req.headers.get("x-telegram-bot-api-secret-token");
  if (header !== secret) {
    throw new Error("Unauthorized");
  }
}

async function handleVoiceMessage(message: z.infer<typeof UpdateSchema>["message"]): Promise<string | null> {
  if (!message?.voice) {
    return null;
  }
  await sendChatAction(message.chat.id, "typing");
  const fileInfo = await getFile(message.voice.file_id);
  const fileBuffer = await downloadFile(fileInfo.file_path);
  const transcription = await transcribeAudio(fileBuffer);
  return transcription;
}

async function respondWithTasks(userId: string, chatId: string | number, tasksText: string[]) {
  if (!tasksText.length) {
    await sendMessage(chatId, "No tasks yet. Add one with /add or send me a note.");
    return;
  }
  const message = tasksText.map((line) => `• ${line}`).join("\n");
  await sendMessage(chatId, message);
}

async function handleTaskCreation(userId: string, chatId: string | number, text: string) {
  const parsed = extractTasksFromText(text);
  if (parsed.length === 0) {
    await sendMessage(chatId, "I couldn't detect any tasks. Try rephrasing or use /add.");
    return;
  }
  const created = await createTasks(userId, parsed);
  const confirmations = created.map((task) => {
    const due = DateTime.fromJSDate(task.dueDate).setZone("Asia/Kolkata").toFormat("dd LLL, hh:mm a");
    return `Task added: ${task.title} — ${due} ✅`;
  });
  await sendMessage(chatId, confirmations.join("\n"));
  await Promise.all(
    created.map((task) =>
      logMessage(task.id, String(chatId), {
        type: "task_created",
        taskId: task.id
      })
    )
  );
}

async function handleCommand(userId: string, chatId: string | number, commandText: string) {
  const parsedCommand = parseCommand(commandText);
  if (!parsedCommand) {
    await handleTaskCreation(userId, chatId, commandText);
    return;
  }

  switch (parsedCommand.type) {
    case "add": {
      const payload = parsedCommand.args[0] ?? "";
      await handleTaskCreation(userId, chatId, payload);
      return;
    }
    case "next": {
      const tasks = await listOpenTasks(userId);
      if (!tasks.length) {
        await sendMessage(chatId, "You have nothing pending. Enjoy your free time! ✅");
        return;
      }
      const formatted = tasks.slice(0, 3).map((task, index) => formatTask(task, index));
      await sendMessage(chatId, `Next up:\n${formatted.map((line) => `• ${line}`).join("\n")}`);
      return;
    }
    case "today":
    case "list": {
      const tasks = await listTodayTasks(userId);
      const formatted = tasks.map((task, index) => formatTask(task, index));
      await respondWithTasks(userId, chatId, formatted);
      return;
    }
    case "done": {
      const index = parsedCommand.args[0] ? parseIndex(parsedCommand.args[0]) : null;
      if (!index) {
        await sendMessage(chatId, "Please specify which task number to mark done. Example: /done 2");
        return;
      }
      const updated = await markTaskDone(userId, index);
      if (!updated) {
        await sendMessage(chatId, "I couldn't find that task number.");
        return;
      }
      await sendMessage(chatId, `Marked done: ${updated.title} ✅`);
      return;
    }
    case "snooze": {
      const index = parsedCommand.args[0] ? parseIndex(parsedCommand.args[0]) : null;
      const duration = parsedCommand.args[1] ? parseDuration(parsedCommand.args[1]) : null;
      if (!index || !duration) {
        await sendMessage(chatId, "Usage: /snooze <taskNumber> <duration>. Example: /snooze 3 2h");
        return;
      }
      const task = await snoozeTask(userId, index, duration);
      if (!task) {
        await sendMessage(chatId, "I couldn't find that task number.");
        return;
      }
      const due = DateTime.fromJSDate(task.dueDate).setZone("Asia/Kolkata").toFormat("dd LLL, hh:mm a");
      await sendMessage(chatId, `Snoozed: ${task.title} ⏰ Now due ${due}`);
      return;
    }
    default:
      await handleTaskCreation(userId, chatId, commandText);
  }
}

async function handleNaturalIntent(userId: string, chatId: string | number, text: string) {
  const intent = interpretNaturalIntent(text);
  if (!intent) {
    await handleTaskCreation(userId, chatId, text);
    return;
  }

  switch (intent) {
    case "next":
      await handleCommand(userId, chatId, "/next");
      return;
    case "today":
      await handleCommand(userId, chatId, "/today");
      return;
    case "list":
      await handleCommand(userId, chatId, "/list");
      return;
    case "done": {
      const match = text.match(/task\s*(\d+)/i);
      if (!match) {
        await sendMessage(chatId, "Tell me which task number to mark done.");
        return;
      }
      await handleCommand(userId, chatId, `/done ${match[1]}`);
      return;
    }
    default:
      await handleTaskCreation(userId, chatId, text);
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTelegramSecret(req);
    const json = await req.json();
    const parsed = UpdateSchema.safeParse(json);
    if (!parsed.success || !parsed.data.message) {
      return NextResponse.json({ ok: true });
    }

    const message = parsed.data.message;
    const chatId = message.chat.id;
    const userTelegramId = String(message.from?.id ?? message.chat.id);
    const user = await upsertUser(userTelegramId, String(chatId));

    let text = message.text ?? message.caption ?? "";

    if (!text && message.voice) {
      try {
        const voiceText = await handleVoiceMessage(message);
        text = voiceText ?? "";
      } catch (err) {
        console.error(err);
        await sendMessage(chatId, "I couldn't transcribe that voice note. Try again?");
        return NextResponse.json({ ok: true });
      }
    }

    if (!text) {
      await sendMessage(chatId, "Send me a task or use /add to create one.");
      return NextResponse.json({ ok: true });
    }

    if (text.trim().startsWith("/")) {
      await handleCommand(user.id, chatId, text.trim());
      return NextResponse.json({ ok: true });
    }

    await handleNaturalIntent(user.id, chatId, text.trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
