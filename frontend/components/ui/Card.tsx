export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-button border border-line bg-surface ${className}`}>{children}</div>
  );
}

export function Section({
  title,
  subtitle,
  count,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  count?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`animate-rise ${className}`}>
      <div className="mb-4 flex items-baseline gap-3 border-b border-line pb-2">
        <h2 className="font-display text-lg font-semibold text-lint">{title}</h2>
        {typeof count === "number" && (
          <span className="font-mono text-xs text-faint">{count}</span>
        )}
        {subtitle && <span className="ml-auto text-xs text-faint">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}
