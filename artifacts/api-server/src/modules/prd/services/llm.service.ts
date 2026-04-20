import type { ApiRoute } from "../../analysis/repository/analysis.repository.js";

export interface PRDSection {
  title: string;
  content: string;
}

export interface GeneratedPRD {
  title: string;
  overview: string;
  sections: PRDSection[];
  generatedAt: string;
}

export function generatePRD(projectName: string, apis: ApiRoute[]): GeneratedPRD {
  const methodGroups = apis.reduce<Record<string, ApiRoute[]>>((acc, api) => {
    if (!acc[api.method]) acc[api.method] = [];
    acc[api.method]!.push(api);
    return acc;
  }, {});

  const resourceGroups = apis.reduce<Record<string, ApiRoute[]>>((acc, api) => {
    const resource = api.path.split("/")[2] ?? "general";
    if (!acc[resource]) acc[resource] = [];
    acc[resource]!.push(api);
    return acc;
  }, {});

  const sections: PRDSection[] = [
    {
      title: "Executive Summary",
      content: `This PRD defines the API surface for the ${projectName} system. The system exposes ${apis.length} API endpoints across ${Object.keys(resourceGroups).length} resource domains, supporting full CRUD operations for legacy system modernization.`,
    },
    {
      title: "API Inventory",
      content: apis
        .map((a) => `• [${a.method}] ${a.path} — ${a.description ?? "No description"}`)
        .join("\n"),
    },
    {
      title: "Resource Domains",
      content: Object.entries(resourceGroups)
        .map(([resource, routes]) => `${resource.toUpperCase()} (${routes.length} endpoints):\n${routes.map((r) => `  - ${r.method} ${r.path}`).join("\n")}`)
        .join("\n\n"),
    },
    {
      title: "HTTP Method Distribution",
      content: Object.entries(methodGroups)
        .map(([method, routes]) => `${method}: ${routes.length} endpoint(s)`)
        .join("\n"),
    },
    {
      title: "Technical Requirements",
      content: [
        "• RESTful API design following HTTP standards",
        "• JSON request/response format",
        "• Authentication required on all non-public endpoints",
        "• Rate limiting: 100 requests per minute per client",
        "• Pagination support for list endpoints (limit/offset)",
        "• Error responses follow RFC 7807 (Problem Details)",
      ].join("\n"),
    },
    {
      title: "User Stories",
      content: apis
        .slice(0, 5)
        .map((a) => `As a developer, I want to ${a.method.toLowerCase()} ${a.path} so that I can ${a.description?.toLowerCase() ?? "perform this operation"}.`)
        .join("\n"),
    },
  ];

  return {
    title: `Product Requirements Document — ${projectName}`,
    overview: `Auto-generated PRD for the modernization of the ${projectName} legacy system. Analyzed ${apis.length} API endpoints to generate this document.`,
    sections,
    generatedAt: new Date().toISOString(),
  };
}
