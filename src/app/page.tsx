import Link from "next/link";

export default function Home() {
  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
        Andinn Organics
      </h1>
      <p style={{ color: "#888", marginBottom: "2rem" }}>
        Autonomous TikTok Affiliate Outreach Agent
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1rem",
        }}
      >
        <DashboardCard
          href="/dashboard"
          title="Dashboard"
          description="Collaborations, costs, agent activity"
        />
        <DashboardCard
          href="/dashboard/approvals"
          title="Content Approvals"
          description="Review and approve content briefs"
        />
        <DashboardCard
          href="/dashboard/review"
          title="HITL Review Queue"
          description="Low-confidence compliance outputs"
        />
        <DashboardCard
          href="/api/health"
          title="Health Check"
          description="System status and connectivity"
        />
      </div>
    </div>
  );
}

function DashboardCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "1.5rem",
        border: "1px solid #333",
        borderRadius: "8px",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>{title}</h2>
      <p style={{ color: "#888", fontSize: "0.9rem" }}>{description}</p>
    </Link>
  );
}
