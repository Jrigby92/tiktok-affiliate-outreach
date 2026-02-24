import Link from "next/link";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/approvals", label: "Content Approvals" },
  { href: "/dashboard/review", label: "HITL Review" },
  { href: "/dashboard/activity", label: "Agent Activity" },
  { href: "/dashboard/costs", label: "Cost Dashboard" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <nav
        style={{
          width: "220px",
          borderRight: "1px solid #333",
          padding: "1rem",
          flexShrink: 0,
        }}
      >
        <Link
          href="/"
          style={{
            display: "block",
            fontSize: "1.1rem",
            fontWeight: 700,
            marginBottom: "1.5rem",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          Andinn Organics
        </Link>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: "block",
              padding: "0.5rem 0.75rem",
              marginBottom: "0.25rem",
              borderRadius: "6px",
              textDecoration: "none",
              color: "#ccc",
              fontSize: "0.9rem",
            }}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: "1.5rem", overflow: "auto" }}>
        {children}
      </main>
    </div>
  );
}
