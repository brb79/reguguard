import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <main className="flex w-full max-w-3xl flex-col items-center justify-center gap-8 px-8 py-16">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-zinc-900">ReguGuard</h1>
          <p className="mt-4 text-lg text-zinc-600">
            AI-driven compliance platform for security guard license management
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
          <Link
            href="/dashboard"
            className="flex flex-col rounded-lg border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-md"
          >
            <h2 className="text-xl font-semibold text-zinc-900">Dashboard</h2>
            <p className="mt-2 text-sm text-zinc-600">
              View expiring licenses, pending renewals, and compliance status
            </p>
          </Link>

          <div className="flex flex-col rounded-lg border border-zinc-200 bg-white p-6">
            <h2 className="text-xl font-semibold text-zinc-900">API Health</h2>
            <p className="mt-2 text-sm text-zinc-600">
              Check system status and service availability
            </p>
            <a
              href="/api/health"
              target="_blank"
              className="mt-4 text-sm text-blue-600 hover:underline"
            >
              View Health Status →
            </a>
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-zinc-500">
          <p>ReguGuard v0.1.0</p>
        </div>
      </main>
    </div>
  );
}
