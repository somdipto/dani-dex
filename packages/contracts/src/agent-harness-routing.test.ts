import { describe, expect, it } from "vitest";
import {
  classifyAgentRole,
  classifyTask,
  describeHarnessRoute,
  fixedHarness,
  routeHarness,
} from "./agent-harness-routing";

const kind = (text: string, purpose?: string) => classifyTask({ text, purpose }).kind;

describe("classifyTask", () => {
  it("reads code, traces, files and commands as technical on their own", () => {
    expect(kind("Why does this fail?\n```\nconst x = 1\n```")).toBe("technical");
    expect(kind('Traceback (most recent call last):\n  File "a.py", line 3')).toBe("technical");
    expect(kind("Can you tidy up src/main/update-service.ts?")).toBe("technical");
    expect(kind("I ran\n$ npm install and it hangs")).toBe("technical");
  });

  it("needs two kinds of evidence from words alone", () => {
    expect(kind("Refactor the backend and add unit tests")).toBe("technical");
    expect(kind("The API returns TypeError when I call it")).toBe("technical");
    expect(kind("What is an API?")).toBe("general");
  });

  it("keeps everyday requests general, including ones that share words with code", () => {
    expect(kind("Plan a 3 day trip to Goa in December")).toBe("general");
    expect(kind("Draft a polite reply to my landlord about the rent")).toBe("general");
    expect(kind("Help me commit to a workout class schedule and a branch of the gym nearby")).toBe("general");
    expect(kind("Summarise this article about python snakes")).toBe("general");
  });

  it("counts an engineering agent's purpose as one piece of evidence", () => {
    expect(kind("Why is the frontend slow?", "Maintain our React codebase")).toBe("technical");
    expect(kind("Why is the frontend slow?", "Plan family trips")).toBe("general");
  });
});

describe("routeHarness", () => {
  const noOmp = { hermes: true, omp: false };

  it("sends general work to Hermes and technical work to OMP when OMP is installed", () => {
    expect(routeHarness("general", noOmp)).toEqual({ kind: "general", harness: "hermes", wanted: null });
    expect(routeHarness("technical", { hermes: true, omp: true })).toEqual({
      kind: "technical",
      harness: "omp",
      wanted: null,
    });
  });

  it("never fails open onto an OMP that is not installed", () => {
    const route = routeHarness("technical", noOmp);
    expect(route).toEqual({ kind: "technical", harness: "hermes", wanted: "omp" });
    expect(describeHarnessRoute(route)).toBe("Technical - Hermes (OMP not installed)");
  });

  it("leaves the provider CLI when no harness is available", () => {
    expect(routeHarness("general", { hermes: false, omp: false })).toEqual({
      kind: "general",
      harness: null,
      wanted: "hermes",
    });
    expect(routeHarness("technical", { hermes: false, omp: false }).harness).toBeNull();
  });

  it("holds a fixed OMP setting to the same rule", () => {
    expect(fixedHarness("omp", noOmp)).toBe("hermes");
    expect(fixedHarness("hermes", noOmp)).toBe("hermes");
    expect(fixedHarness("hermes", { hermes: false, omp: false })).toBeNull();
  });
});

describe("classifyAgentRole", () => {
  const role = (name: string, title = "", description = "") => classifyAgentRole({ name, title, description }).kind;

  it("reads a technical job title as technical with no purpose written", () => {
    expect(role("CTO")).toBe("technical");
    expect(role("Maya", "Backend engineer")).toBe("technical");
    expect(role("DevOps helper")).toBe("technical");
  });

  it("falls back to the purpose for everyone else", () => {
    expect(role("Nova", "", "Review pull requests and refactor the backend")).toBe("technical");
    expect(role("Travel planner", "", "Plan family trips and book hotels")).toBe("general");
    expect(role("Chef")).toBe("general");
  });
});
