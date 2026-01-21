# Metabase + Hetzner + Supabase – Brief Instructions for Codex

This document is meant as **context + goals** for a Codex-style agent.  
It should **not** be followed as literal code; instead, use it to design and implement the actual solution in the target codebase.

---

## 1. Current Infrastructure Context

### 1.1 Hetzner Cloud Server

- Provider: **Hetzner Cloud**
- Location: **Helsinki**
- Server type: **CX23, Docker CE Ubuntu image (Ubuntu 24.04)**
- Public IP: managed via DNS as `analytics.upseller.fi`
- Access:
  - SSH is restricted to a non-root user: `analytics`
  - SSH login:
    - **Root login disabled**
    - **Password authentication disabled**
    - **ED25519 SSH key authentication only**
- Firewalls:
  - **Hetzner Cloud Firewall**
    - Inbound allowed: TCP `22`, TCP `3000` (temporary for Metabase HTTP)
    - Outbound: default open
  - **UFW on the server**
    - Default: `deny` incoming, `allow` outgoing
    - Allowed inbound: `22` (SSH), `3000` (Metabase HTTP)
- Security expectations for Codex:
  - Do **not** weaken SSH settings.
  - Maintain the split between Hetzner firewall (network edge) and UFW (host firewall).
  - Any new exposed ports must be explicitly justified and configured in both firewalls.

### 1.2 Docker / Metabase Stack

- Docker and Docker Compose plugin are installed via the Hetzner Docker CE image.
- Application directory: `/opt/metabase`
- Stack components:
  - **PostgreSQL** container for Metabase _application database_ (not Supabase)
  - **Metabase** container
- Persistence:
  - A local volume under `/opt/metabase/postgres-data` stores Metabase’s internal DB.
- Current exposure:
  - Metabase is reachable at:
    - `http://65.108.242.142:3000`
    - `http://analytics.upseller.fi:3000`
  - It is currently plain HTTP (no TLS) for initial setup / internal use.
- Expectations for Codex:
  - Treat `/opt/metabase` as the canonical app directory.
  - Assume docker-compose is the orchestration mechanism.
  - Any changes to the stack should be made without losing Metabase’s application data.
  - Do not expose Postgres directly to the internet.

### 1.3 Supabase Project Context

- Supabase Postgres has these tables (in `public` schema):
  - `event_write_tokens` – ingestion tokens (sensitive)
  - `events_raw` – raw analytics events
  - `tenant_domains`
  - `tenants`
  - `vf_credentials` – encrypted API keys (sensitive)
  - `vf_projects`
  - `vf_pulls` – ingestion/pull logs
  - `vf_usage` – usage metrics (JSON payload)
- We want Metabase to query analytics data but **never** see:
  - `vf_credentials`
  - `event_write_tokens`
  - Any secrets or internal tokens
- A concept of an **`analytics` schema** has been introduced to hold safe, read-only views over public tables.
- A **separate read‑only DB user** for Metabase is planned (or partly created) but implementation details should be validated and completed by Codex.

---

## 2. What Has Been Done So Far

This is a summary of actions already performed; Codex should treat these as the baseline.

### 2.1 Server and SSH Hardening

- Non-root admin user `analytics` created and added to the `sudo` group.
- SSH configuration changed:
  - `PermitRootLogin no`
  - `PasswordAuthentication no`
  - `PubkeyAuthentication yes`
- SSH access validated via key-only login as `analytics`.
- Hetzner firewall and UFW configured so that:
  - Only ports `22` and `3000` are exposed.
  - Incoming default is deny; outgoing default is allow.

### 2.2 Metabase Deployment

- Docker-based Metabase stack set up on `/opt/metabase`.
- Metabase is using a dedicated Postgres instance as its application DB (inside Docker, not Supabase).
- Containers are running and verified via HTTP on port `3000`.
- Initial Metabase onboarding completed up to the step where data sources can be added.

### 2.3 Supabase Design Direction

- Intention to avoid connecting Metabase using Supabase’s service role or any over‑privileged role.
- Intention to create:
  - `analytics` schema in Supabase.
  - Views under `analytics.*` that expose only safe data from `events_raw`, `vf_usage`, `vf_pulls`, etc.
  - A dedicated read-only DB user (e.g. `metabase_readonly`) with access **only** to the `analytics` schema.
- The schema snippet shows the actual table structure; Codex should use it as context when designing views and permissions.

---

## 3. Goals for Codex

Codex should take the current state and implement the **next steps**. There is freedom in the exact code and tooling, but the following goals and constraints must be respected.

### 3.1 Supabase: Analytics Schema and Read-Only Access

**Goal:** Metabase can connect to Supabase using a least-privilege DB user that sees only analytics‑safe data.

Codex should:

1. **Design and implement an `analytics` schema** in Supabase.
   - Create views on top of:
     - `events_raw` – expose only fields and derived metrics that are safe to analyze.
     - `vf_usage` – expose timestamp, tenant, project, metric and expanded JSON metrics.
     - `vf_pulls` – expose status, windows, timestamps for pipeline monitoring.
   - Avoid exposing tables like `vf_credentials` and `event_write_tokens` entirely.

2. **Set up a dedicated read-only Postgres role** for Metabase.
   - Grant usage and select only on `analytics` schema.
   - Explicitly avoid or revoke privileges on `public` tables by default.
   - Consider how RLS interacts with this role and adjust policies as needed (or rely purely on role/ACL if RLS is not yet used).

3. **Document connection details for Metabase (conceptually)**.
   - Codex should not store secrets in code, but should clearly define which config variables must exist (host, db name, read-only user, password, SSL requirement).

### 3.2 Metabase: Connecting to Supabase Safely

**Goal:** Metabase uses the Supabase read-only user to query analytics data.

Codex should:

1. Ensure Metabase is configured (via its UI or environment configuration) to add Supabase as a PostgreSQL data source using the read-only role.
2. Confirm that only the `analytics` schema is visible in Metabase’s data model.
3. Avoid embedding DB credentials directly in source code; prefer environment configuration mechanisms appropriate for the deployment.

### 3.3 HTTPS and Reverse Proxy (Future-Proofing)

**Goal:** Move from `http://analytics.upseller.fi:3000` to `https://analytics.upseller.fi` in a secure and maintainable way.

Codex should design and, if in scope, implement:

1. A reverse proxy layer (e.g. Nginx / Nginx Proxy Manager / Traefik) in front of Metabase.
   - Terminate TLS using Let’s Encrypt certificates for `analytics.upseller.fi`.
   - Proxy traffic to the Metabase container on internal port 3000.

2. A firewall adjustment plan:
   - Eventually close port `3000` to the public internet (in Hetzner firewall and UFW).
   - Keep only ports `22`, `80`, and `443` open externally.
   - Optionally restrict SSH (22) to known IPs once operational.

3. A way to update certificates automatically and reload the proxy without downtime.

Codex may choose the exact reverse proxy implementation and Compose layout, as long as it stays compatible with Docker on this host and preserves existing Metabase data.

### 3.4 Backups and Resilience

**Goal:** Ensure data durability for both Metabase’s app DB and Supabase analytics data.

Codex should consider and, if appropriate for the codebase:

- Define a backup strategy for `/opt/metabase/postgres-data` (filesystem or container-level).
- Integrate with Supabase’s existing backup capabilities for the analytics database.
- Optionally define retention, rotation and restore procedures at a conceptual level.

### 3.5 Security Considerations Codex Must Respect

- Do **not** re-enable root SSH login or password authentication.
- Do **not** expose Postgres directly on a public port.
- Be cautious with Docker port bindings; any new ports must be justified and firewalled.
- Preserve separation of concerns:
  - Hetzner firewall = perimeter filter.
  - UFW = host firewall.
  - Docker network = internal service communication.
- Keep secrets (DB passwords, API keys) externalized (environment variables, secret management), not hard-coded.
- Any multi-tenant considerations should assume that Metabase may eventually be used by multiple tenant users, so views and permissions should be designed to allow future per-tenant scoping if required.

---

## 4. Deliverables Expected from Codex

Codex is expected to produce, in the target repo or infrastructure code:

1. **Supabase-side SQL or migration definitions** that:
   - Create the `analytics` schema.
   - Create the necessary analytics views.
   - Create and configure the read-only DB role and grants.

2. **Metabase configuration changes** that:
   - Use the read-only Supabase role as the data source.
   - Avoid mixing application secrets with analytics configuration.

3. **Infrastructure updates (if in scope)** that:
   - Introduce a reverse proxy with TLS for `analytics.upseller.fi`.
   - Adjust Hetzner and UFW firewall rules accordingly.
   - Provide basic backup/restore procedures for Metabase’s app DB volume.

4. **Light documentation** in the project repo explaining:
   - How to set up the Supabase analytics role and views.
   - How Metabase connects to Supabase.
   - How the reverse proxy and firewall pieces fit together.

The intent is for Codex to design the concrete implementation details, while this document provides the **constraints, security expectations, and end goals**.
