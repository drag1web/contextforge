import { motion } from "framer-motion";
import { BrainCircuit, FolderOpen, Gauge, Sparkles } from "lucide-react";

function App() {
  const handleSelectProject = async () => {
    const selectedPath = await window.contextforge?.selectProjectFolder?.();

    if (selectedPath) {
      console.log("Selected project:", selectedPath);
    }
  };

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <aside className="flex w-72 flex-col border-r border-white/10 bg-white/[0.03] p-5">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/30">
            <BrainCircuit size={24} />
          </div>

          <div>
            <h1 className="text-lg font-semibold tracking-tight">ContextForge</h1>
            <p className="text-xs text-slate-400">AI project control center</p>
          </div>
        </div>

        <nav className="space-y-2 text-sm text-slate-300">
          <div className="rounded-xl bg-white/10 px-4 py-3 text-white">Dashboard</div>
          <div className="rounded-xl px-4 py-3 hover:bg-white/5">Projects</div>
          <div className="rounded-xl px-4 py-3 hover:bg-white/5">Context Builder</div>
          <div className="rounded-xl px-4 py-3 hover:bg-white/5">Task Packs</div>
          <div className="rounded-xl px-4 py-3 hover:bg-white/5">Settings</div>
        </nav>

        <div className="mt-auto rounded-2xl border border-white/10 bg-slate-900/80 p-4">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">MVP Status</p>
          <p className="text-sm text-slate-300">Phase 0.1 — Project Scanner</p>
        </div>
      </aside>

      <section className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-white/10 px-8">
          <div>
            <p className="text-sm text-slate-400">Welcome back</p>
            <h2 className="text-xl font-semibold">Dashboard</h2>
          </div>

          <button
            onClick={handleSelectProject}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400"
          >
            <FolderOpen size={17} />
            Add project
          </button>
        </header>

        <div className="flex-1 overflow-auto p-8">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="mb-8"
          >
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
              <Sparkles size={14} />
              Local-first AI workflow manager
            </p>

            <h3 className="max-w-3xl text-4xl font-semibold tracking-tight text-white">
              Prepare your projects for Codex, Cursor, Claude Code and other AI agents.
            </h3>

            <p className="mt-4 max-w-2xl text-slate-400">
              ContextForge scans your project, builds AI-ready context, generates task packs,
              and helps prevent AI agents from breaking your architecture.
            </p>
          </motion.div>

          <div className="grid grid-cols-3 gap-5">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <div className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
                <Gauge size={22} />
              </div>
              <p className="text-sm text-slate-400">AI Readiness</p>
              <p className="mt-2 text-3xl font-semibold">—</p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <p className="text-sm text-slate-400">Projects</p>
              <p className="mt-2 text-3xl font-semibold">0</p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <p className="text-sm text-slate-400">Task Packs</p>
              <p className="mt-2 text-3xl font-semibold">0</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
