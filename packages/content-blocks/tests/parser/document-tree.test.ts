import { describe, expect, it } from "vitest";
import { parseDocument } from "../../src/parser/parse-document.js";
import { serializeDocument } from "../../src/parser/serialize-document.js";
import type { ContentBlock, ContentDocument } from "../../src/types.js";
import { at } from "../helpers.js";

function flattenBlocks(block: ContentBlock): ContentBlock[] {
  const result: ContentBlock[] = [block];
  if (block.children) {
    for (const child of block.children) {
      result.push(...flattenBlocks(child));
    }
  }
  return result;
}

function findBlock(blocks: ContentBlock[], title: string): ContentBlock {
  const found = blocks.find((b) => b.title === title);
  if (!found) {
    throw new Error(`Block with title "${title}" not found`);
  }
  return found;
}

describe("document tree: full structured representation", () => {
  const bigDocument = `---
id: project-spec-001
createdAt: 2026-03-15T08:00:00Z
format: v2
title: Project Specification
---
id: msg-001
role: tool:content-extractor
stage: done
time: 2026-03-15T08:01:00Z
type: extraction-done
uri: project:/docs/architecture.md

# System Architecture

This document describes the overall system design.

## Frontend

The frontend is a React SPA.

### Components

#### Layout Components

Header, Footer, Sidebar.

#### Page Components

Home, Dashboard, Settings.

### State Management

Uses Zustand for global state.

## Backend

Node.js services with Express.

### API Layer

RESTful endpoints with OpenAPI spec.

#### Authentication

JWT-based auth with refresh tokens.

#### Rate Limiting

Token bucket algorithm, 100 req/min.

### Data Layer

#### PostgreSQL

Primary data store with Drizzle ORM.

#### Redis

Cache layer for sessions and hot data.

## Infrastructure

### Docker

Multi-stage builds for each service.

### Kubernetes

Helm charts for deployment.

#### Monitoring

Prometheus + Grafana dashboards.

#### Alerting

PagerDuty integration for critical alerts.

---
id: msg-002
role: tool:content-extractor
stage: done
time: 2026-03-15T08:02:00Z
type: extraction-done
uri: project:/docs/api-reference.md

# API Reference

Complete API documentation.

## Authentication Endpoints

### POST /auth/login

Authenticates a user and returns tokens.

Request body:
\`\`\`json
{
  "email": "user@example.com",
  "password": "secret"
}
\`\`\`

### POST /auth/refresh

Refreshes an expired access token.

### POST /auth/logout

Invalidates the current session.

## User Endpoints

### GET /users/me

Returns the authenticated user's profile.

### PATCH /users/me

Updates the authenticated user's profile.

### GET /users/:id

Returns a specific user (admin only).

## Resource Endpoints

### GET /resources

List all resources with pagination.

#### Query Parameters

- \`page\` (number) - Page number
- \`limit\` (number) - Items per page
- \`sort\` (string) - Sort field

### POST /resources

Create a new resource.

### GET /resources/:id

Get a specific resource.

### PUT /resources/:id

Update a resource.

### DELETE /resources/:id

Delete a resource.

---
id: msg-003
role: tool:content-extractor
stage: done
time: 2026-03-15T08:03:00Z
type: extraction-done
uri: project:/CHANGELOG.md

# Changelog

## v2.1.0 (2026-03-10)

### Features

- Added dark mode support
- New dashboard widgets

### Bug Fixes

- Fixed memory leak in WebSocket handler
- Resolved timezone issues in date picker

## v2.0.0 (2026-02-15)

### Breaking Changes

- Removed legacy API v1 endpoints
- Changed authentication flow to OAuth2

### Features

- Complete UI redesign
- Real-time collaboration

### Bug Fixes

- Fixed race condition in concurrent edits

## v1.5.0 (2026-01-20)

### Features

- Export to PDF
- Bulk operations

---
id: msg-004
role: assistant
time: 2026-03-15T08:04:00Z

Analysis complete. Processed 3 documents.
`;

  it("parses full document with correct structure", () => {
    const doc = parseDocument(bigDocument);

    expect(doc.props?.id).toBe("project-spec-001");
    expect(doc.props?.title).toBe("Project Specification");
    expect(doc.content).toHaveLength(4);
  });

  it("section 1 (architecture): has correct deep block hierarchy", () => {
    const doc = parseDocument(bigDocument);
    const section = at(doc.content, 0);

    expect(section.props?.uri).toBe("project:/docs/architecture.md");

    const sysArch = findBlock(section.blocks, "System Architecture");
    expect(sysArch.content).toContain("overall system design");
    expect(sysArch.children).toHaveLength(3); // Frontend, Backend, Infrastructure

    // Frontend
    const frontend = at(sysArch.children, 0);
    expect(frontend.title).toBe("Frontend");
    expect(frontend.children).toHaveLength(2); // Components, State Management

    const components = at(frontend.children, 0);
    expect(components.title).toBe("Components");
    expect(components.children).toHaveLength(2); // Layout, Page
    expect(at(components.children, 0).title).toBe("Layout Components");
    expect(at(components.children, 0).content).toContain("Header, Footer, Sidebar");
    expect(at(components.children, 1).title).toBe("Page Components");

    // Backend
    const backend = at(sysArch.children, 1);
    expect(backend.title).toBe("Backend");
    expect(backend.children).toHaveLength(2); // API Layer, Data Layer

    const apiLayer = at(backend.children, 0);
    expect(apiLayer.title).toBe("API Layer");
    expect(apiLayer.children).toHaveLength(2); // Authentication, Rate Limiting
    expect(at(apiLayer.children, 1).content).toContain("Token bucket");

    const dataLayer = at(backend.children, 1);
    expect(dataLayer.title).toBe("Data Layer");
    expect(dataLayer.children).toHaveLength(2); // PostgreSQL, Redis

    // Infrastructure
    const infra = at(sysArch.children, 2);
    expect(infra.title).toBe("Infrastructure");
    expect(infra.children).toHaveLength(2); // Docker, Kubernetes

    const k8s = at(infra.children, 1);
    expect(k8s.title).toBe("Kubernetes");
    expect(k8s.children).toHaveLength(2); // Monitoring, Alerting
  });

  it("section 2 (api-reference): has correct endpoint hierarchy", () => {
    const doc = parseDocument(bigDocument);
    const section = at(doc.content, 1);

    expect(section.props?.uri).toBe("project:/docs/api-reference.md");

    const apiRef = findBlock(section.blocks, "API Reference");
    expect(apiRef.children).toHaveLength(3); // Auth, User, Resource endpoints

    const auth = at(apiRef.children, 0);
    expect(auth.title).toBe("Authentication Endpoints");
    expect(auth.children).toHaveLength(3);
    expect(at(auth.children, 0).title).toBe("POST /auth/login");
    expect(at(auth.children, 0).content).toContain("```json");

    const resources = at(apiRef.children, 2);
    expect(resources.title).toBe("Resource Endpoints");
    expect(resources.children).toHaveLength(5);

    const getList = at(resources.children, 0);
    expect(getList.title).toBe("GET /resources");
    expect(getList.children).toHaveLength(1); // Query Parameters
    expect(at(getList.children, 0).content).toContain("`page`");
  });

  it("section 3 (changelog): has correct version hierarchy", () => {
    const doc = parseDocument(bigDocument);
    const section = at(doc.content, 2);

    const changelog = findBlock(section.blocks, "Changelog");
    expect(changelog.children).toHaveLength(3); // v2.1.0, v2.0.0, v1.5.0

    const v210 = at(changelog.children, 0);
    expect(v210.title).toBe("v2.1.0 (2026-03-10)");
    expect(v210.children).toHaveLength(2); // Features, Bug Fixes
    expect(at(v210.children, 0).content).toContain("dark mode");

    const v200 = at(changelog.children, 1);
    expect(v200.title).toBe("v2.0.0 (2026-02-15)");
    expect(v200.children).toHaveLength(3); // Breaking Changes, Features, Bug Fixes
  });

  it("section 4 (plain text): has no block children", () => {
    const doc = parseDocument(bigDocument);
    const section = at(doc.content, 3);

    expect(section.props?.role).toBe("assistant");
    expect(at(section.blocks, 0).content).toBe("Analysis complete. Processed 3 documents.");
  });

  it("counts total blocks across all sections", () => {
    const doc = parseDocument(bigDocument);
    let totalBlocks = 0;
    for (const section of doc.content) {
      for (const block of section.blocks) {
        totalBlocks += flattenBlocks(block).length;
      }
    }
    expect(totalBlocks).toBeGreaterThan(30);
  });

  it("full round-trip: parse → serialize → parse produces identical structure", () => {
    const doc1 = parseDocument(bigDocument);
    const serialized = serializeDocument(doc1);
    const doc2 = parseDocument(serialized);
    const reserialized = serializeDocument(doc2);

    expect(reserialized).toBe(serialized);
  });

  it("document tree is JSON-serializable and deserializable", () => {
    const doc = parseDocument(bigDocument);

    const json = JSON.stringify(doc, null, 2);
    const restored = JSON.parse(json) as ContentDocument;

    expect(restored.props).toEqual(doc.props);
    expect(restored.content).toHaveLength(doc.content.length);

    for (let i = 0; i < doc.content.length; i++) {
      expect(at(restored.content, i).props).toEqual(at(doc.content, i).props);
      expect(at(restored.content, i).blocks).toEqual(at(doc.content, i).blocks);
    }
  });
});
