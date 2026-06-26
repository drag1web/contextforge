interface PlaceholderPageProps {
  title: string;
  description: string;
  items?: string[];
}

export function PlaceholderPage({
  title,
  description,
  items = []
}: PlaceholderPageProps) {
  return (
    <section className="cf-card p-8">
      <p className="cf-badge mb-5">Coming soon</p>

      <h3 className="text-2xl font-semibold tracking-tight text-white">{title}</h3>

      <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">
        {description}
      </p>

      {items.length > 0 && (
        <div className="mt-7 grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <div
              key={item}
              className="rounded-xl border border-neutral-900 bg-black/40 p-4 text-sm text-neutral-400"
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}