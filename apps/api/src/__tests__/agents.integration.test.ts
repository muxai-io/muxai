import { describe, it, expect } from "vitest";
import { setupTestDb, getTestPrisma } from "./setup-db";

setupTestDb();

describe("agents integration", () => {
  it("creates an agent and retrieves it", async () => {
    const prisma = getTestPrisma();

    const agent = await prisma.agent.create({
      data: {
        name: "Test Analyst",
        role: "analyst",
        title: "BTC Analyst",
        adapterType: "claude_local",
        adapterConfig: { effort: "high", systemPrompt: "You are a test agent." },
      },
    });

    expect(agent.id).toBeDefined();
    expect(agent.name).toBe("Test Analyst");
    expect(agent.role).toBe("analyst");
    expect(agent.status).toBe("idle");

    const fetched = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Test Analyst");
    expect((fetched!.adapterConfig as Record<string, unknown>).effort).toBe("high");
  });

  it("creates an agent with default values", async () => {
    const prisma = getTestPrisma();

    const agent = await prisma.agent.create({
      data: { name: "Minimal Agent" },
    });

    expect(agent.role).toBe("general");
    expect(agent.adapterType).toBe("claude_local");
    expect(agent.status).toBe("idle");
    expect(agent.adapterConfig).toEqual({});
    expect(agent.runtimeConfig).toEqual({});
  });

  it("updates agent status", async () => {
    const prisma = getTestPrisma();

    const agent = await prisma.agent.create({
      data: { name: "Status Agent", role: "engineer" },
    });

    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: { status: "running" },
    });

    expect(updated.status).toBe("running");
  });

  it("deletes agent and cascades runs", async () => {
    const prisma = getTestPrisma();

    const agent = await prisma.agent.create({
      data: { name: "Deletable Agent" },
    });

    await prisma.heartbeatRun.create({
      data: { agentId: agent.id, status: "succeeded" },
    });

    await prisma.agent.delete({ where: { id: agent.id } });

    const runs = await prisma.heartbeatRun.findMany({ where: { agentId: agent.id } });
    expect(runs).toHaveLength(0);
  });

  it("supports agent hierarchy (reportsTo)", async () => {
    const prisma = getTestPrisma();

    const lead = await prisma.agent.create({
      data: { name: "Team Lead", role: "ceo" },
    });

    const reporter = await prisma.agent.create({
      data: { name: "Analyst", role: "analyst", reportsToId: lead.id },
    });

    const leadWithReports = await prisma.agent.findUnique({
      where: { id: lead.id },
      include: { reports: true },
    });

    expect(leadWithReports!.reports).toHaveLength(1);
    expect(leadWithReports!.reports[0].name).toBe("Analyst");
    expect(reporter.reportsToId).toBe(lead.id);
  });

  it("lists agents ordered by creation date", async () => {
    const prisma = getTestPrisma();

    await prisma.agent.create({ data: { name: "First" } });
    await prisma.agent.create({ data: { name: "Second" } });
    await prisma.agent.create({ data: { name: "Third" } });

    const agents = await prisma.agent.findMany({ orderBy: { createdAt: "asc" } });
    expect(agents).toHaveLength(3);
    expect(agents.map((a: { name: string }) => a.name)).toEqual(["First", "Second", "Third"]);
  });
});
