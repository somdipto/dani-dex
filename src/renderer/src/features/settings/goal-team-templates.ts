/** Local group-chat blueprints inspired by public use cases at https://x.ai/bot/use-cases.
 * These are original Dani-Dex team roles, not imported third-party agents or promised connectors.
 * Every blueprint is executable through the same agent and channel commands as manual creation.
 */
export interface GoalTeamTemplate {
  id: string;
  category: string;
  name: string;
  summary: string;
  roles: readonly { name: string; responsibility: string }[];
}

const categoryRoles: Record<string, readonly [string, string, string]> = {
  General: ["Researcher", "Planner", "Reviewer"],
  Sales: ["Account Researcher", "Outreach Writer", "Pipeline Reviewer"],
  Marketing: ["Audience Researcher", "Campaign Writer", "Performance Reviewer"],
  "Customer Success & Support": ["Customer Researcher", "Response Writer", "Account Reviewer"],
  "Recruiting & People": ["Candidate Researcher", "Outreach Writer", "Hiring Reviewer"],
  "Operations & Finance": ["Records Researcher", "Operations Planner", "Compliance Reviewer"],
  Product: ["User Researcher", "Product Planner", "Quality Reviewer"],
  Engineering: ["Technical Investigator", "Implementer", "Test Reviewer"],
  "Life & Leverage": ["Options Researcher", "Action Planner", "Decision Reviewer"],
};

const useCases: readonly [string, string, string][] = [
  [
    "Customer Success & Support",
    "Account Health",
    "Coordinate account health work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Customer Success & Support",
    "Account Manager",
    "Coordinate account manager work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Sales",
    "Account Research Specialist",
    "Coordinate account research specialist work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Life & Leverage",
    "Apartment Scout",
    "Coordinate apartment scout work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Product",
    "Beta Adoption Watcher",
    "Coordinate beta adoption watcher work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Engineering",
    "Bug Reproduction",
    "Coordinate bug reproduction work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "General",
    "Calendar Coordinator",
    "Coordinate calendar coordinator work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Sales",
    "Call FAQ Miner",
    "Coordinate call faq miner work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "General",
    "Chief of Staff",
    "Coordinate chief of staff work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Engineering",
    "Cloud Agent Orchestrator",
    "Coordinate cloud agent orchestrator work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "Community Operations Manager",
    "Coordinate community operations manager work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Sales",
    "Compelling Events Monitor",
    "Coordinate compelling events monitor work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "Competitive Intelligence Analyst",
    "Coordinate competitive intelligence analyst work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Operations & Finance",
    "Contract Desk",
    "Coordinate contract desk work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Sales",
    "CRM Operations Manager",
    "Coordinate crm operations manager work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "General",
    "Daily Briefing Writer",
    "Coordinate daily briefing writer work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Sales",
    "Deal Desk Coordinator",
    "Coordinate deal desk coordinator work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Sales",
    "Deck Updater",
    "Coordinate deck updater work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Product",
    "Docs Auditor",
    "Coordinate docs auditor work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Customer Success & Support",
    "Enablement Fulfillment Specialist",
    "Coordinate enablement fulfillment specialist work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "Event Guest Screener",
    "Coordinate event guest screener work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "General",
    "Executive Assistant",
    "Coordinate executive assistant work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Operations & Finance",
    "Expense Manager",
    "Coordinate expense manager work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Product",
    "Feature Request Tracker",
    "Coordinate feature request tracker work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Recruiting & People",
    "Hiring Screener",
    "Coordinate hiring screener work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "General",
    "Inbox Manager",
    "Coordinate inbox manager work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "Internal Communications Manager",
    "Coordinate internal communications manager work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Operations & Finance",
    "Invoice Coordinator",
    "Coordinate invoice coordinator work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "LinkedIn Campaign Manager",
    "Coordinate linkedin campaign manager work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "Marketing Calendar Owner",
    "Coordinate marketing calendar owner work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "General",
    "Meeting Prep Buddy",
    "Coordinate meeting prep buddy work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Operations & Finance",
    "Merch Fulfillment Operator",
    "Coordinate merch fulfillment operator work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "Newsletter Writer",
    "Coordinate newsletter writer work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Customer Success & Support",
    "Onboarding Manager",
    "Coordinate onboarding manager work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "Paid Media",
    "Coordinate paid media work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "Paid Media Creative Strategist",
    "Coordinate paid media creative strategist work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Life & Leverage",
    "Personal Site Builder",
    "Coordinate personal site builder work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Sales",
    "Pipeline Analyst",
    "Coordinate pipeline analyst work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Product",
    "Playtest Operator",
    "Coordinate playtest operator work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "Presentation Designer",
    "Coordinate presentation designer work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Product",
    "Product Feedback Analyst",
    "Coordinate product feedback analyst work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Engineering",
    "Product Performance",
    "Coordinate product performance work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Sales",
    "Prospecting Plan Builder",
    "Coordinate prospecting plan builder work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Engineering",
    "Prototype Builder",
    "Coordinate prototype builder work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Sales",
    "Renewal Desk Operator",
    "Coordinate renewal desk operator work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Sales",
    "Sales Call Coach",
    "Coordinate sales call coach work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Sales",
    "Sales Outbound",
    "Coordinate sales outbound work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Operations & Finance",
    "Security Questionnaire Filler",
    "Coordinate security questionnaire filler work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "SEO / AEO Auditor",
    "Coordinate seo / aeo auditor work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Marketing",
    "Social Media Manager",
    "Coordinate social media manager work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "General",
    "Status Report Writer",
    "Coordinate status report writer work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Life & Leverage",
    "Subscription Cleaner",
    "Coordinate subscription cleaner work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Recruiting & People",
    "Talent Scout",
    "Coordinate talent scout work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Customer Success & Support",
    "Ticket Triage Specialist",
    "Coordinate ticket triage specialist work: research the inputs, prepare the work, and review the result together.",
  ],
  [
    "Life & Leverage",
    "Travel Coordinator",
    "Coordinate travel coordinator work: research the inputs, prepare the work, and review the result together.",
  ],
];

export const GOAL_TEAM_TEMPLATES: readonly GoalTeamTemplate[] = useCases.map(([category, name, summary]) => {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const [researcher, maker, reviewer] = categoryRoles[category] ??
    categoryRoles.General ?? ["Researcher", "Planner", "Reviewer"];
  return {
    id,
    category,
    name,
    summary,
    roles: [
      {
        name: researcher,
        responsibility: `Gather the inputs and cite the evidence needed for ${name.toLowerCase()}. State what is missing rather than inventing facts.`,
      },
      {
        name: maker,
        responsibility: `Use the research to produce the requested ${name.toLowerCase()} work. Coordinate with the other channel members and report your output in the channel.`,
      },
      {
        name: reviewer,
        responsibility: `Check the ${name.toLowerCase()} work against the goal, sources, and constraints. Flag gaps and prepare a clear final handoff.`,
      },
    ],
  };
});

export function goalTeamInstructions(template: GoalTeamTemplate): string {
  return `Shared goal: ${template.name}. ${template.summary} The lead coordinates the members and reports progress and a final result in this channel. Work from real sources; if an integration is unavailable, state the blocker. Do not send messages, spend money, publish, or change external systems without the user's approval. Ask the user to describe the specific goal before starting work.`;
}
