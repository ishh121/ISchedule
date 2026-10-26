# ISCHEDULE
## AI-BASED COLLEGE TIMETABLE PLANNING SYSTEM

### A Mini Project Report

Submitted in partial fulfilment of the requirements for the award of the degree of

**BACHELOR OF TECHNOLOGY**

**IN**

**INFORMATION TECHNOLOGY**

### Submitted by

| Student name | Roll number |
| --- | --- |
| B Nitish Kumar | A24126511007 |
| K Mani Babu | A24126511025 |
| P Sai Kiran | A24126511038 |
| T Harshitha | A24126511051 |
| K Prasoona | A24126511183 |

### Under the guidance of

**[Project Guide Name]**  
**[Designation]**  
**Department of Information Technology**

---

**DEPARTMENT OF INFORMATION TECHNOLOGY**  
**ANIL NEERUKONDA INSTITUTE OF TECHNOLOGY AND SCIENCES (UGC AUTONOMOUS)**  
*(Affiliated to AU, Approved by AICTE and Accredited by NBA & NAAC with “A+” Grade)*  
Sangivalasa, Bheemili Mandal, Visakhapatnam District, Andhra Pradesh  
**2026–27**

---

## CERTIFICATE

This is to certify that the mini project report entitled **“ISchedule: AI-Assisted College Timetable Planning System”** is submitted by the students listed above from the Department of Information Technology, Anil Neerukonda Institute of Technology and Sciences (Autonomous), as part of the AI Pedagogy Mini Project.

The final report and the evidence of implementation and evaluation are to be verified by the faculty guide before signatures are provided. This certificate section is a project-report template and does not represent prior verification.

| Project Guide | Head of the Department |
| --- | --- |
| [Name and signature] | [Name and signature] |
| [Designation] | [Designation] |

## DECLARATION

We hereby declare that the project work entitled **“ISchedule: AI-Assisted College Timetable Planning System”** is a record of original work carried out by the listed team members under the guidance of **[Project Guide Name]**, [Designation], Department of Information Technology, Anil Neerukonda Institute of Technology and Sciences. This work is submitted in partial fulfilment of the requirements for the award of the degree of Bachelor of Technology in Information Technology. To the best of our knowledge, this work has not been submitted for the award of any other degree or diploma at any other university.

| Student name | Roll number | Signature |
| --- | --- | --- |
| B Nitish Kumar | A24126511007 | |
| K Mani Babu | A24126511025 | |
| P Sai Kiran | A24126511038 | |
| T Harshitha | A24126511051 | |
| K Prasoona | A24126511183 | |

## ACKNOWLEDGEMENT

We express our sincere gratitude to our project guide, **[Project Guide Name]**, for the guidance, technical suggestions and encouragement provided throughout the project. We are thankful to the Head of the Department and the faculty members of the Department of Information Technology, ANITS, for providing the academic environment and resources required to complete this work.

We also thank the institution for providing access to the development environment and testing facilities. Finally, we thank our parents, friends and classmates for their continued encouragement and support during the planning, implementation, testing and documentation of ISchedule.

## ABSTRACT

Preparing a college timetable is a constraint-heavy planning problem. A timetable must assign courses to periods and rooms while respecting faculty availability, student-group conflicts, room capacity, room type, required room features, teaching days, session duration and weekly session counts. Manual preparation becomes difficult as the number of courses, teachers, rooms and student groups increases, and a small change can invalidate several existing assignments.

ISchedule is a full-stack AI-based college timetable planning system designed to support resource management, timetable generation, manual adjustment, publication and role-based access. The intended shared-workspace flow makes AI the primary timetable planner: the model receives the complete scheduling problem and proposes actual course, day, period and room assignments. ISchedule then validates the proposed timetable against hard constraints, requests a repair when the proposal is invalid, and saves only an accepted result. The deterministic constraint engine remains an independent safety validator and an offline fallback for local workspaces; it is not the primary planner in shared AI mode.

The system supports local browser-only workspaces and shared server-backed workspaces. It includes a React and Vite frontend, a Node.js server, SQLite persistence, Web Workers for local scheduling, CSV import, CSV and ICS export, accounts, roles, workspace versions, publication, audit history and history restoration. The supported local AI configuration uses Ollama through its OpenAI-compatible `/v1/chat/completions` endpoint with the `llama3.2:3b` model. The server-side provider is configurable through environment variables, and the provider key is never sent to the browser.

The repository verification snapshot used while preparing this report produced 42 passing unit/API tests, 8 passing Playwright browser scenarios, a successful production build, and a successful isolated Ollama application-flow check. These checks establish the surrounding application, validation and deployment baseline. The AI-first placement contract must be verified with tests that assert that the model returns complete session assignments and that repair feedback produces a valid final timetable. Privacy, model reliability, provider availability, explainability and human review remain important conditions for real-world deployment.

**Keywords:** Artificial Intelligence, Timetable Scheduling, Constraint Satisfaction, Generative AI, Ollama, React, SQLite, Responsible AI, Higher Education.

## TABLE OF CONTENTS

1. Project Overview and Mapping to CO-4 / SDG 4  
2. Problem Identification and AI Application Understanding  
3. AI Tool / Framework Utilization  
4. Efficiency / Performance Evaluation  
5. Scalability and Practical Applicability  
6. Ethical / Social Implications and Presentation of Findings  
7. Conclusion and Future Scope  
References  
Appendix A: Sample Inputs and Test Data  
Appendix B: Screenshot and Evidence Register  
Appendix C: Individual Contributions  
Appendix D: Project Work Log  
Appendix E: Rubric Self-Assessment Matrix

> Page numbers should be updated after opening the DOCX in Microsoft Word. The report uses heading levels so that an automatic table of contents can be generated.

## 1. PROJECT OVERVIEW AND MAPPING TO CO-4 / SDG 4

### 1.1 Project title and context

**Project title:** ISchedule: AI-Based College Timetable Planning System.

ISchedule is intended for colleges that prepare weekly timetables for courses, faculty, rooms and student groups. The application provides a shared planning workspace in which an administrator or planner can maintain academic resources, generate a timetable, review conflicts, manually adjust sessions, save versions and publish a selected timetable to authorised users.

The project treats timetable generation as a constrained AI planning problem. In shared mode, **Generate Plan** sends the complete planning problem to the AI solver. The model proposes the actual timetable sessions, including course, day, period and room. A local validation layer checks every proposed session and reports conflicts back to the AI for bounded repair. Soft preferences such as morning teaching, balanced student days, fewer gaps and avoidance of the final period guide the AI, but never override hard constraints. In local mode, the deterministic solver remains available as an offline fallback.

### 1.2 Course Outcome and SDG mapping

| Assignment element | Alignment | How ISchedule demonstrates it |
| --- | --- | --- |
| CO-4 | Evaluate AI applications across domains considering efficiency, scalability and ethical implications while using modern AI tools/frameworks. | The project evaluates an AI timetable-planning workflow, documents the provider configuration, validates structured model-generated sessions, defines repair and fallback behaviour, measures repository-level test outcomes and discusses limitations. |
| SDG 4 | Quality education and effective learning environments. | A reliable timetable can support the organisation of teaching resources and reduce avoidable scheduling conflicts. This is a design alignment, not a measured claim that the project improves educational outcomes. |

### 1.3 Overall project workflow

1. An administrator or planner opens a local or shared workspace.
2. Faculty, rooms, student groups and courses are created or imported.
3. Constraints and preferences are validated by the application.
4. In a shared workspace, the **Generate Plan** action invokes the configured AI timetable planner. The AI proposes complete session placements; ISchedule validates them and sends structured conflict feedback for repair when necessary.
5. In a local workspace, the scheduler runs in a browser Web Worker without a server AI request.
6. The planner reviews placed sessions, unscheduled sessions, quality and conflicts.
7. Sessions may be manually moved, locked or removed where permissions allow.
8. The administrator can save a named version, publish it and expose it to faculty, students or viewers according to role.
9. CSV and term-aware ICS exports can be generated for operational use.

### 1.4 Scope and boundaries

**Included:** resource CRUD, faculty availability, AI-generated timetable planning, candidate validation and repair, deterministic offline fallback, manual planning, CSV import, CSV/ICS export, roles, shared workspaces, optimistic revisions, versions, publication, audit records and history restoration.

**Not claimed by this report:** guaranteed global optimality, unsupervised institution-wide operation, measured superiority over every scheduling algorithm, direct student performance prediction or automatic academic decision-making. AI is the primary planner in the proposed shared-workspace architecture, but the final timetable still requires deterministic validation and human approval.

## 2. PROBLEM IDENTIFICATION AND AI APPLICATION UNDERSTANDING

### 2.1 Real-world problem

Academic timetable preparation involves many resources and interdependent rules. For each course, the institution must schedule a required number of sessions with a suitable faculty member, student group and room. Faculty may be unavailable during selected periods, rooms may have different capacities or types, laboratories may require features, and student groups cannot attend overlapping courses. Multi-period sessions also cannot cross breaks. A manual spreadsheet-based approach makes it difficult to guarantee consistency after changes.

The problem is not simply to fill empty cells. It is to find a feasible assignment that satisfies hard constraints and, among feasible assignments, prefers a better distribution of teaching periods and student workload.

### 2.2 Problem statement

How can a college timetable planning system combine a configurable AI assistant with a constraint-based scheduling engine so that planners can create, validate, revise and publish timetables while preserving hard academic and resource constraints?

### 2.3 Need and motivation

- Manual timetable preparation is time-consuming and error-prone.
- A small resource change can create conflicts across faculty, groups and rooms.
- Planners need explanations for unscheduled sessions rather than a silent failure.
- Different users need different visibility: administrators and planners edit drafts, while viewers should see only published information.
- AI can propose a complete timetable more flexibly than a fixed priority rule, but its output must be structured, validated and repairable before it affects an operational timetable.
- A local deterministic fallback is useful when network access or AI-provider access is unavailable.

### 2.4 Objectives and verification

| Objective | Verification evidence |
| --- | --- |
| O1. Model courses, faculty, rooms and student groups. | Resource editor, TypeScript data model and browser resource tests. |
| O2. Generate schedules that respect hard constraints. | Scheduler unit tests, API tests and `validateSchedule()` assertions. |
| O3. Integrate a modern AI provider safely. | Server-side provider configuration, strict JSON schema, exact-ID checks and Ollama application-flow test. |
| O4. Support correction and review. | Manual planning board, locked sessions, reports, versions and history restoration. |
| O5. Provide secure shared operation. | SQLite persistence, sessions, roles, workspace isolation, publication filtering and audit history. |
| O6. Provide usable operational output. | CSV/ICS export tests and term/time-zone-aware calendar implementation. |

### 2.5 Existing approach and limitations

| Existing approach | Limitation | ISchedule response |
| --- | --- | --- |
| Manual spreadsheet or paper planning | Conflicts are easy to miss and changes are difficult to propagate. | Central resource model and explicit validation. |
| Fixed manual priority order | The most constrained course may be planned too late and the planner must repeatedly repair conflicts. | AI proposes a complete timetable while the validator identifies and reports conflicts for repair. |
| Basic first-fit placement | A valid early choice can make later sessions impossible. | AI considers the full planning context; deterministic validation rejects invalid candidates and the fallback solver remains available. |
| Informal sharing of drafts | Unpublished data may reach the wrong audience. | Roles, workspace isolation, versioning and publication. |
| One-off timetable files | Calendar and operational reuse is limited. | CSV and recurring ICS export bounded by an academic term. |

### 2.6 Selected AI application and applicability

The AI application is a **generative AI timetable planner** used on the server. It is not a trained predictive model and does not use a student-performance dataset. The provider receives the complete scheduling context represented as course, faculty, room and group records, period definitions, availability, preferences and locked sessions. Its required output is a strict JSON object containing actual session placements: course ID, day, period, room ID and lock state. The model therefore performs the central planning task rather than merely arranging a priority list.

This is applicable because timetable planning requires simultaneous reasoning about many interacting resources. A single priority list cannot express the final room and period decisions. The AI-first design asks the model to produce the complete candidate timetable, then uses deterministic validation to reject unknown resources, missing sessions, overlaps, capacity violations, unavailable periods and other hard-constraint failures. If the candidate is invalid, the server returns the violations to the model for a bounded repair attempt. The local deterministic solver is retained only for offline mode and recovery.

### 2.7 Assumptions and limitations

- Workspace data is accurate and references existing faculty, groups and rooms.
- The model can follow the requested JSON structure, but structured output does not guarantee good planning quality.
- Tests use synthetic deterministic fixtures and isolated temporary databases.
- The tested course sizes are suitable for a mini-project demonstration, not a proof of campus-scale throughput.
- The report describes the AI-first timetable-planner architecture requested for the project. Repository test results are retained as baseline evidence; AI-placement-specific tests must be added for complete session output, validation and repair.

## 3. AI TOOL / FRAMEWORK UTILIZATION

### 3.1 Tool selection and justification

The implementation uses an OpenAI-compatible chat-completions interface. The documented local configuration uses **Ollama 0.40.6** with the `llama3.2:3b` model at `http://127.0.0.1:11434/v1`. This choice supports local execution without sending workspace data to a paid external service and is suitable for a controlled demonstration.

The server keeps the provider configuration private. The browser calls ISchedule’s `/api/ai/plan` endpoint; the server calls the configured provider. This design avoids exposing the provider key in frontend JavaScript.

### 3.2 Actual environment and tools

| Component | Actual project detail |
| --- | --- |
| Frontend | React 19 with Vite 6 and TypeScript 5.7. |
| Server | Node.js 24+, native HTTP server and SQLite persistence. |
| AI interface | OpenAI-compatible `/v1/chat/completions` endpoint. |
| Verified local provider | Ollama 0.40.6. |
| Verified local model | `llama3.2:3b`. |
| Browser scheduling | TypeScript scheduler executed in `src/scheduler.worker.ts`. |
| Unit/API testing | Vitest. |
| Browser testing | Playwright with Chromium. |
| Data storage | SQLite for server workspaces, browser storage for local mode. |
| Project package | `ischedule-timetable`, version 1.0.0. |

### 3.3 Data and feature specification

The project does not use personal student-performance data. Its planning data is synthetic or institution-entered timetable data:

| Entity | Representative fields | Purpose |
| --- | --- | --- |
| Course | id, name, code, facultyId, groupId, weeklySessions, duration, roomType, requiredFeatures | Defines teaching demand. |
| Faculty | id, name, department, maxDailyPeriods, unavailable, preferred | Defines teaching capacity and availability. |
| Room | id, name, building, capacity, type, features | Defines physical resource suitability. |
| Student group | id, name, department, size, semester | Defines cohort demand and room capacity requirement. |
| Preferences | days, preferMorning, balancedDays, avoidLastPeriod, avoidGaps, balanceFacultyLoad | Guides AI placement selection and local fallback scoring without overriding hard constraints. |
| Locked session | id, courseId, day, period, roomId, locked | Preserves a planner-approved placement during regeneration. |

The AI prompt includes the complete planning fields, timetable grid, hard-constraint rules and locked sessions. Direct identifiers and secrets are not part of the AI workflow. A production deployment should still review whether faculty names or email addresses are necessary and should minimise data sent to an external provider.

### 3.4 Implementation and configuration procedure

1. Install Node.js 24 or newer and project dependencies.
2. Configure the provider on the server using `.env` or deployment environment variables.
3. For local Ollama, pull `llama3.2:3b` and expose its OpenAI-compatible endpoint.
4. Start the development environment with `npm run dev`.
5. Register an account; the first account becomes the administrator.
6. Add or import timetable resources.
7. Use **Generate Plan** in a shared workspace to invoke the AI timetable planner, or use the same action in a browser-only workspace to invoke the offline fallback solver.
8. Inspect the returned timetable and reports before publishing.
9. Preserve audit and test evidence without recording provider secrets.

### 3.5 AI request and validation flow

```text
Planner clicks Generate Plan
    ↓
POST /api/ai/plan
    ↓
Role and workspace validation
    ↓
Complete scheduling prompt: courses, rooms, faculty, groups, periods,
availability, preferences, locked sessions and hard-constraint rules
    ↓
AI returns strict JSON containing complete session placements
{ sessions: [{ id, courseId, day, period, roomId, locked }] }
    ↓
Schema, resource-ID, completeness and duplicate checks
    ↓
Deterministic validation checks every hard constraint
    ↓
If invalid: structured conflict feedback is sent to AI for repair
    ↓
Valid candidate is summarised with quality and unscheduled sessions
    ↓
Validated schedule returned and saved through workspace persistence
```

### 3.6 Prompt and generative AI record

The server asks the AI to solve the timetable as a complete planning problem. The prompt contains the available days and periods, period boundaries and breaks, course session requirements, duration, faculty availability and limits, group sizes, room capacities and types, required features, soft preferences and locked sessions. The model must return only JSON with a `sessions` array. Each session contains an exact course ID, a valid day, a valid period, an exact room ID and a lock flag. The model is explicitly told not to return explanations, invented identifiers or placements outside the supplied timetable grid.

The validation layer performs checks after every provider response. It rejects malformed JSON, unknown course or room IDs, duplicate session IDs, missing or excessive sessions, changed locked sessions, overlaps, incorrect room capacity or type, missing room features, unavailable faculty, daily-limit violations, disabled teaching days and sessions that cross breaks. When repair is enabled, the rejected candidate and its machine-generated violation list are sent back to the model for another complete solution. No candidate is saved until it passes validation.

### 3.7 Evidence checklist

| Evidence ID | Evidence item | Location or result |
| --- | --- | --- |
| E1 | Provider configuration | `.env.example`, `README.md`, `server/app.mjs`. Secrets are excluded from the report. |
| E2 | Data schema | `src/types.ts`, CSV templates and Section 3.3. |
| E3 | AI implementation | `server/app.mjs:createAiSchedule()`, `src/api.ts`, `src/App.tsx`; target contract returns complete sessions. |
| E4 | Provider execution | `npm run test:ollama -- --app-flow`: validated schedule returned. |
| E5 | Automated verification | `npm test`: 42 tests passed. |
| E6 | Browser verification | `npm run test:e2e`: 8 tests passed. |
| E7 | Build verification | `npm run build`: successful, with a bundle-size warning. |

## 4. EFFICIENCY / PERFORMANCE EVALUATION

### 4.1 Evaluation design

This project is a timetable-generation system rather than a labelled student-classification model. Therefore accuracy, precision, recall and F1-score are not appropriate for the AI planning task. The evaluation uses controlled scheduling cases, candidate-validity rate, session completeness, hard-constraint violation count, repair success rate, unscheduled-session count, response time and browser workflows. A schedule is successful only when the AI-generated candidate is complete or its remaining unscheduled sessions are explicitly reported and every accepted session satisfies the hard constraints.

The tests use deterministic synthetic fixtures and temporary server data directories. They verify behaviour such as exact course IDs, preservation of locked sessions, rejection of invalid AI output, workspace isolation, publication rules, history restoration and resource creation through the interface.

### 4.2 Test cases and observed results

| ID | Test purpose | Expected behaviour | Observed result |
| --- | --- | --- | --- |
| T01 | Empty workspace sent to AI | Reject before provider call; do not change workspace. | Passed in API tests. |
| T02 | Valid AI timetable response | Accept complete course/day/period/room placements with zero hard-constraint violations. | AI-first acceptance test required after contract migration. |
| T03 | Locked session | Preserve every locked placement exactly during AI planning and repair. | Validation requirement; baseline lock test passed. |
| T04 | Missing or excessive session | Reject or repair a candidate that does not meet weekly session requirements. | AI-first acceptance test required. |
| T05 | Conflict candidate | Detect faculty, group, room, capacity, feature, availability or break violations and return them as repair feedback. | AI-first acceptance test required. |
| T06 | AI provider application flow | Ollama responds and ISchedule validates a complete AI-generated timetable. | Baseline app flow passed with `llama3.2:3b`; complete-placement assertion pending migration. |
| T07 | Local UI generation | Create resources through UI and generate two sessions. | Passed in Playwright. |
| T08 | Published viewer access | Viewer sees published data but not draft workspace. | Passed in API coverage. |
| T09 | History restoration | Restore older snapshot as a new revision and reject stale revision. | Passed in API and browser coverage. |
| T10 | Production build | TypeScript, Vite and server bundle complete. | Passed. |

### 4.3 Measured repository-level results

| Check | Command | Observed result |
| --- | --- | --- |
| Unit/API tests | `npm test` | 6 test files passed; 42 tests passed. |
| Production build | `npm run build` | Passed; main JavaScript bundle approximately 660.40 kB before gzip. |
| Browser scenarios | `npm run test:e2e` | 8 tests passed in approximately 22.9 seconds in the final run. |
| Local provider | `npm run test:ollama` | Ollama 0.40.6 reachable; OpenAI-compatible chat responded. |
| Application AI flow | `npm run test:ollama -- --app-flow` | Passed; isolated ISchedule server returned a validated schedule. |
| Static diff check | `git diff --check` | Passed for the verified changes. |

### 4.4 Constraint and output quality evaluation

For an AI-generated candidate, the project checks room type, room capacity, room features, faculty availability, faculty daily limits, room conflicts, faculty conflicts, group conflicts, disabled days, session duration, breaks, locked-session preservation and weekly session completeness. The quality score is calculated only after validation and is a heuristic that rewards or penalises soft preferences. It does not replace the AI planner and it does not prove optimality.

The score is not a guarantee of optimality. It is useful for comparing candidate schedules produced by repeated local search, but the report does not claim that the highest score is globally optimal or that it represents educational quality.

### 4.5 Error analysis

The most relevant failure cases are:

- A provider may return course codes instead of internal IDs. The strict schema and server-side exact-ID validation address this case.
- A provider may return duplicate, missing or excessive sessions. Completeness and uniqueness checks address the issue.
- A provider may assign a room with insufficient capacity, wrong type or missing features. Candidate validation rejects the placement and returns a repair reason.
- A workspace may not contain enough compatible rooms. The validator reports unscheduled sessions and a reason instead of silently accepting an invalid assignment.
- Faculty availability may make a multi-period course impossible. The validator checks each occupied period, including continuation periods.
- The model may repair one conflict by creating another conflict. Every repair attempt is validated from the complete candidate again.
- The AI provider may be unavailable or rate-limited. The server returns an error and the current timetable is not overwritten by an invalid provider response.
- A local browser user may be offline. The Web Worker scheduler continues to support local generation without a provider request.

### 4.6 Evaluation limitations

The current results are functional verification results, not an independent performance benchmark. The project did not measure CPU and memory profiles across large institutions, provider cost across repeated requests, or statistically compare AI-generated placements with deterministic and hybrid baselines. The local Ollama connectivity and baseline application flow were verified; the complete AI-placement contract must be verified after the AI-first implementation is applied. The OpenAI path is configurable but was not included in the verified results. These limitations should be addressed before making deployment or cost claims.

## 5. SCALABILITY AND PRACTICAL APPLICABILITY

### 5.1 Intended operational setting

The intended users are administrators and academic planners who maintain resources and prepare a timetable, together with faculty, students and viewers who consume a published result. The planner remains responsible for reviewing unscheduled sessions and conflicts before publication.

The system supports two modes:

- **Shared mode:** the server stores a workspace in SQLite, enforces roles and can call the configured AI provider.
- **Local mode:** the browser stores a workspace locally and runs the deterministic scheduler in a Web Worker.

### 5.2 Scalability dimensions

| Dimension | Current design | Assessment |
| --- | --- | --- |
| Data volume | CSV imports are limited to 500 records per resource type. | Suitable for controlled imports; larger institutional imports need batching and load testing. |
| Search complexity | AI proposes a complete candidate and can repair validation failures; local fallback uses constraint search. | More courses and constraints increase prompt size, output size and repair time; benchmark evidence is still required. |
| AI context and output | The prompt includes workspace planning data and the model returns one session object per placement. | Large workspaces may exceed context or output limits and may need staged solving by group, day or department. |
| Concurrent users | SQLite persistence and optimistic revisions are used. | Suitable for a small shared deployment; concurrency and backup recovery require production testing. |
| Browser workload | Local scheduling runs in a Web Worker. | Keeps the interface responsive for tested workloads; larger cases need browser profiling. |
| Provider availability | AI is server-side and configurable. | External provider downtime, quota and network latency affect shared AI planning. |
| Output integration | CSV and ICS exports are available. | Supports basic operational reuse; LMS/ERP integration is future work. |

### 5.3 Practical applicability

ISchedule can be used as an AI-based timetable planner for a department or small college. The workflow is practical because AI performs the main placement search while the application provides safety checks and review: planners can inspect reports, repair or manually move sessions, lock decisions, save versions, publish only an approved version and restore previous draft history.

The system is not intended to replace academic administration. It should be introduced with an owner for resource data, a review checklist, a publication policy and a recovery procedure. A timetable should not be published solely because an AI response was returned.

### 5.4 Larger-scale test plan

Future evaluation should run controlled datasets with increasing numbers of courses, groups, faculty and rooms. Each workload should be repeated under the same Node.js, browser and provider configuration. The following should be recorded:

- Time to first valid schedule.
- Number of AI solve and repair attempts.
- Number of unscheduled sessions.
- Constraint violations before and after validation.
- Browser CPU and memory usage.
- Server CPU, memory and SQLite write time.
- AI prompt/output token counts and provider cost where applicable.
- Failure rate under provider timeout, malformed output and rate-limit conditions.

### 5.5 Limitations and deployment conditions

- A small synthetic test cannot establish campus-scale scalability.
- SQLite is convenient for a mini-project but requires operational backup and concurrency planning.
- AI provider output may vary by model and configuration.
- Larger prompts may expose unnecessary institutional details unless data minimisation is applied.
- Provider cost, internet availability and quota must be monitored when using a paid API.
- A stronger model or staged planning approach may be needed for large timetables.
- Deployment should use HTTPS, secure cookies, protected environment variables and an external data directory.

## 6. ETHICAL / SOCIAL IMPLICATIONS AND PRESENTATION OF FINDINGS

### 6.1 Privacy and data minimisation

The system handles academic planning data rather than student performance data. Even so, faculty names, email addresses, group names and room details can be operationally sensitive. The server keeps provider credentials away from the browser. Production deployments should minimise provider input to fields needed for planning, avoid sending unnecessary email addresses, use institution-approved providers and keep secrets outside source control.

The repository’s E2E and AI-flow checks use temporary databases and synthetic `.invalid` accounts. This is appropriate for testing because it avoids sending real user records to the provider.

### 6.2 Reliability and automation bias

Generative AI can return a syntactically valid but invalid or poor timetable. The project mitigates this with a strict session schema, exact resource-ID checks, complete candidate validation and bounded repair attempts. A planner must still review the final result, especially unscheduled sessions and soft-preference trade-offs.

The interface should not describe an AI result as an optimal timetable. It should communicate that the result is generated, validated and subject to human approval.

### 6.3 Transparency and human oversight

The current design makes the AI boundary inspectable:

- The server records an AI planning audit event with the model name and placement summary.
- The prompt asks for a complete placement candidate with explicit course, day, period and room assignments.
- Hard constraints are implemented in project code and can be tested independently.
- Planners can edit, lock, save, publish and restore schedules.
- Viewers, faculty and students do not receive draft workspace access.

Human review remains necessary because a technically valid timetable may still be unsuitable for institutional policy, accessibility, staff preferences or exceptional events.

### 6.4 Ethical and social risk matrix

| Risk | Possible harm | Mitigation in ISchedule |
| --- | --- | --- |
| Invalid AI output | Conflicting or unusable timetable. | Strict JSON schema, exact-ID checks and constraint validation. |
| Provider outage | Planner cannot use shared AI planning at that moment. | Clear errors, local deterministic mode and manual planning controls. |
| Privacy exposure | Operational data sent to an unauthorised provider. | Server-side provider call, secret isolation, data minimisation and institution approval. |
| Automation bias | Staff accept an AI result without review. | Reports, unscheduled-session warnings, version review and explicit publication action. |
| Unfair resource allocation | Soft preferences may favour one group or teacher. | Document preferences, review generated schedules and retain manual correction. |
| Access-control failure | Draft data exposed to viewers or unrelated workspaces. | Roles, workspace scoping, publication filtering and API tests. |
| Data loss | A bad import or edit damages a draft. | Backups, versions, audit history and history restoration. |
| Digital exclusion | Users cannot access a shared provider or browser. | Local mode, exports and a manual planning workflow. |

### 6.5 SDG 4: Quality Education

ISchedule is related to SDG 4 through the goal of supporting organised, effective and inclusive teaching environments. A timetable that reduces avoidable clashes can help departments use teaching resources more consistently. This report does not claim that ISchedule has measured an improvement in educational outcomes or SDG indicators. Any such claim would require an approved institutional study with appropriate outcome measures.

### 6.6 Responsible-use boundaries

- Do not publish a timetable without planner or administrator review.
- Do not send secrets or unnecessary personal information to an AI provider.
- Do not treat AI output as proof of optimality.
- Do not use the system to make unrelated high-stakes decisions about students or staff.
- Keep an audit trail of model, configuration and publication decisions.
- Provide a manual correction and recovery path when provider output is wrong.
- Re-evaluate performance when the curriculum, resources or provider model changes.

### 6.7 Presentation of findings

The final report distinguishes measured repository checks from design assessments and future work. The 42 passing tests, 8 passing browser scenarios and successful Ollama application flow are observed results under the local environment used for verification. Scalability, cost and institution-wide effectiveness are not presented as measured facts.

## 7. CONCLUSION AND FUTURE SCOPE

### 7.1 Conclusion

Under the tested local environment, ISchedule successfully demonstrated a full-stack timetable planning workflow with resource management, deterministic constraint validation, role-based publication, history restoration and operational exports. The AI-first design makes the model responsible for proposing complete timetable sessions, while the application validates and repairs the proposal before publication. The verified repository baseline included 42 passing unit/API tests, 8 passing browser scenarios, a successful production build and a successful isolated Ollama application flow using `llama3.2:3b`.

The evidence supports the conclusion that the surrounding prototype is functionally coherent for the tested scenarios. In the AI-first architecture, AI is the key timetable planner rather than a priority-list assistant; deterministic code acts as the safety validator and local fallback. A stronger deployment claim requires complete-placement tests, repair-loop evidence, comparison with the offline solver and larger approved workloads.

### 7.2 Future scope

- Make **Generate Plan** invoke the AI-first solver for shared workspaces while preserving the local deterministic fallback.
- Ask the model for actual course/day/period/room placements and use the local code primarily as a validator and repair coordinator.
- Add and verify bounded AI repair attempts with structured validation feedback.
- Compare AI-first, deterministic and hybrid approaches on identical datasets.
- Measure provider latency, token usage, cost and failure recovery.
- Add larger synthetic workload benchmarks and production-like concurrency tests.
- Add calendar and LMS integration after security and institutional approval.
- Improve the UI’s progress reporting for AI planning and validation stages.
- Add stronger accessibility testing and user feedback from planners and faculty.
- Monitor model changes, drift in resource patterns and repeated failure cases.

## REFERENCES

[1] ISchedule project documentation, `README.md`, repository version used for this report.

[2] ISchedule server implementation, `server/app.mjs`, repository version used for this report.

[3] ISchedule scheduling engine, `src/scheduler.ts`, repository version used for this report.

[4] ISchedule automated API and unit tests, `tests/api.test.ts`, `tests/scheduler.test.ts`, `tests/planning.test.ts`, `tests/csv.test.ts`, `tests/calendar.test.ts`.

[5] ISchedule Playwright browser tests, `e2e/app.spec.ts`.

[6] Ollama, “OpenAI compatibility,” available at: https://docs.ollama.com/api/openai-compatibility, accessed October 2026.

[7] United Nations Department of Economic and Social Affairs, “Goal 4: Ensure inclusive and equitable quality education and promote lifelong learning opportunities for all,” available at: https://sdgs.un.org/goals/goal4, accessed October 2026.

[8] React, Vite, TypeScript, Vitest and Playwright project documentation, consulted through the project configuration and package metadata.

## APPENDIX A: SAMPLE INPUTS / TEST DATA

The following records are synthetic examples used to explain the project schema. They are not real institutional records.

| Course ID | Course code | Faculty ID | Group ID | Weekly sessions | Duration | Room type |
| --- | --- | --- | --- | ---: | ---: | --- |
| c101 | AI101 | f01 | g01 | 2 | 1 | lecture |
| c102 | DB102 | f02 | g01 | 2 | 1 | lecture |
| c103 | LAB103 | f03 | g01 | 1 | 2 | lab |

| Room ID | Capacity | Type | Features |
| --- | ---: | --- | --- |
| r01 | 60 | lecture | projector,whiteboard |
| r02 | 30 | lab | projector,computers |

| Test condition | Expected behaviour |
| --- | --- |
| Unknown course ID returned by provider | Reject AI response. |
| Duplicate course ID returned by provider | Reject AI response. |
| Faculty unavailable during a candidate period | Do not accept the placement. |
| Room capacity smaller than group size | Do not accept the placement. |
| Locked session supplied | Preserve it during regeneration. |

## APPENDIX B: SCREENSHOT AND EVIDENCE REGISTER

| Evidence ID | Evidence item | File, command or screen | What it proves | Verified |
| --- | --- | --- | --- | --- |
| E1 | Development environment | `.env.example`, `package.json`, README | Actual tools and configuration shape. | Yes |
| E2 | Resource schema | `src/types.ts`, Settings and CSV import UI | Course, faculty, room and group inputs. | Yes |
| E3 | AI request path | `server/app.mjs`, `src/api.ts`, `src/App.tsx` | Server-side provider call and role protection. | Yes |
| E4 | AI application result | `npm run test:ollama -- --app-flow` | Local provider responded and ISchedule validated a schedule. | Yes |
| E5 | Automated tests | `npm test` | 42 unit/API tests passed. | Yes |
| E6 | Browser suite | `npm run test:e2e` | 8 Playwright scenarios passed. | Yes |
| E7 | Production build | `npm run build` | TypeScript, frontend and server bundle completed. | Yes |
| E8 | UI screenshots | [Insert screenshots from the running application] | Visual evidence of overview, resources, timetable and admin controls. | To be inserted |

## APPENDIX C: INDIVIDUAL CONTRIBUTIONS

Complete the contribution details and evidence before submission.

| Student name / roll number | Work area | Specific contribution | Evidence |
| --- | --- | --- | --- |
| B Nitish Kumar (A24126511007) | [To be assigned] | [Actual contribution] | [Evidence to be added] |
| K Mani Babu (A24126511025) | [To be assigned] | [Actual contribution] | [Evidence to be added] |
| P Sai Kiran (A24126511038) | [To be assigned] | [Actual contribution] | [Evidence to be added] |
| T Harshitha (A24126511051) | [To be assigned] | [Actual contribution] | [Evidence to be added] |
| K Prasoona (A24126511183) | [To be assigned] | [Actual contribution] | [Evidence to be added] |

## APPENDIX D: PROJECT WORK LOG

| Activity | Output | Member(s) | Feedback / next step |
| --- | --- | --- | --- |
| Problem definition and scope | Timetable-planning problem statement | Project team | Confirm constraints and roles. |
| Data model and resource screens | Courses, faculty, rooms and groups | Project team | Validate import and edit flows. |
| Scheduler implementation | Constraint search and quality scoring | Project team | Add larger workload benchmarks. |
| AI integration | Provider configuration, complete session schema and repair validation | Project team | Rerun complete-placement and repair-loop evidence after implementation. |
| Shared workspace controls | Accounts, versions, publication and history | Project team | Review deployment security. |
| Testing and report | Test logs, evidence register and report | Project team | Insert screenshots and signatures. |

## APPENDIX E: RUBRIC SELF-ASSESSMENT MATRIX

| Rubric criterion | Maximum marks | Indicative self-assessment | Evidence / gap |
| --- | ---: | ---: | --- |
| 1. Problem Identification and AI Application Understanding | 4 | 4 | Clear timetable problem and AI-first planner role; complete-placement evidence should be attached. |
| 2. AI Tool / Framework Utilization | 4 | 3 | Ollama application-flow baseline verified; complete session schema and repair-loop evidence must be rerun after migration. |
| 3. Efficiency / Performance Evaluation | 4 | 3 | Functional test results documented; large-scale performance and cost benchmarks remain. |
| 4. Scalability and Practical Applicability | 4 | 3 | Shared/local modes and deployment limits assessed; institution-scale testing remains. |
| 5. Ethical / Social Implications and Presentation | 4 | 3 | Privacy, reliability, access and human-review risks addressed; screenshots and final team details remain. |
| **TOTAL** | **20** | **15 / 20 indicative** | Faculty review and evidence insertion required before final submission. |

> The indicative scores are not an official evaluation. The faculty guide should revise them after reviewing the final implementation evidence, screenshots and team contributions.
