export default function HomePage() {
  return (
    <main>
      <h1>Telegram Task Assistant</h1>
      <p>
        Deploy the bot with the required environment variables to start managing your
        tasks directly from Telegram using natural language and voice commands.
      </p>
      <p>
        Configure <code>TELEGRAM_BOT_TOKEN</code>, <code>TELEGRAM_BOT_SECRET</code>,
        <code>OPENAI_API_KEY</code>, and <code>DATABASE_URL</code> then point your
        Telegram webhook to <code>/api/telegram</code>.
      </p>
    </main>
  );
}
