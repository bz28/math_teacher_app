# Incident Response & Breach Notification Policy

**Version:** 1.0
**Owner:** Veradic LLC
**Last reviewed:** May 23, 2026

This policy describes how Veradic responds to security incidents and notifies affected school districts and other customers. It is provided to procurement teams as part of district due-diligence and is summarized publicly on the Veradic Trust & Security page at https://veradicai.com/trust.

---

## 1. Scope

This policy applies to all confirmed or suspected security incidents involving Veradic systems, customer data, or services, including:

- Unauthorized access to systems or accounts
- Unauthorized acquisition, disclosure, or modification of customer data
- Loss or theft of devices containing customer data
- Denial of service affecting service availability
- Malware or compromise of Veradic infrastructure

---

## 2. Definitions

**Incident** — Any event that may compromise the confidentiality, integrity, or availability of Veradic systems or customer data.

**Security Incident** — A confirmed incident affecting customer data, accounts, or production services.

**Breach** — A Security Incident that, on the basis of available facts, reasonably appears to have resulted in unauthorized access to or acquisition of personally identifiable information.

**Affected Party** — Any school district, customer, or individual whose data may have been compromised by a Security Incident.

---

## 3. Detection and Triage

Veradic operates monitoring and logging across production systems. Indicators of incidents may originate from:

- Automated monitoring and alerting
- Manual review of logs and metrics
- Reports from customers, users, or third parties
- Reports from security researchers via the Responsible Disclosure channel (support@veradicai.com)

Upon receipt of an indicator, the on-call engineer performs initial triage to determine:

1. Whether a real incident is in progress;
2. The scope of potentially affected systems and data;
3. The likely severity and impact; and
4. Whether to escalate to the full incident response process.

---

## 4. Response Phases

### 4.1 Identify
Confirm the existence and nature of the incident. Gather initial evidence. Assign an incident lead.

### 4.2 Contain
Take immediate action to limit further damage. This may include revoking compromised credentials, isolating affected systems, blocking malicious traffic, or rotating secrets.

### 4.3 Eradicate
Remove the root cause of the incident from affected systems. Apply patches or configuration changes as necessary.

### 4.4 Recover
Restore affected services to normal operation. Verify that the incident has been fully resolved and that no residual access remains.

### 4.5 Post-Incident Review
Within a reasonable time after recovery, conduct a written post-incident review documenting the timeline, root cause, response actions taken, and recommended improvements.

---

## 5. Notification to Affected Parties

### 5.1 Timing

Where a Security Incident affects customer data, Veradic will notify each Affected Party in writing **within seventy-two (72) hours** of confirmation that the incident has occurred and affects that party's data. This timing applies regardless of whether the incident rises to the level of a legally defined "breach."

### 5.2 Content of Initial Notification

The initial notification will include, to the extent known at the time:

- A description of the nature of the incident;
- The categories and approximate number of data subjects affected;
- The categories of data affected;
- The actions Veradic has taken or is taking to contain and remediate the incident; and
- A point of contact for follow-up questions.

### 5.3 Ongoing Updates

Veradic will provide written updates to Affected Parties as material new information becomes available, until the incident is closed.

### 5.4 Cooperation

Veradic will cooperate in good faith with Affected Parties in any required notifications to individuals or regulators, including providing such factual information as is reasonably required for the Affected Party to fulfill its own notification obligations under applicable law (e.g., FERPA, COPPA, state breach notification laws, the Pennsylvania Breach of Personal Notification Data Act).

### 5.5 Notification Channel

Initial notifications are sent to the primary administrative contact on file for each Affected Party, with a copy to any data privacy or procurement contact provided in the customer's DPA.

---

## 6. Communication With Other Stakeholders

Public disclosures regarding incidents will be reviewed prior to release. Veradic will not unilaterally publish details that could compromise an ongoing investigation or expose Affected Parties to additional risk.

Internal communications to Veradic personnel will be limited to those with a need to know in connection with the response.

---

## 7. Documentation and Records

For each Security Incident, Veradic retains:

- The initial indicator and triage notes
- A timeline of response actions
- Copies of notifications sent to Affected Parties
- The post-incident review

Records are retained for a period consistent with applicable law and Veradic's record-retention practices.

---

## 8. Roles and Responsibilities

- **Incident Lead** — Coordinates the response, makes containment decisions, owns external communication.
- **Engineering On-Call** — Investigates technical aspects, implements containment and eradication actions.
- **Customer Communications** — Drafts and sends notifications to Affected Parties.
- **Leadership** — Approves external communication and engagement of outside counsel or forensic firms as needed.

In a small organization, individuals may hold multiple roles. The Incident Lead ensures all responsibilities are assigned for each incident.

---

## 9. Testing and Review

This policy is reviewed at least annually. Improvements identified in post-incident reviews are incorporated into the policy as appropriate.

---

## 10. Contact

To report a suspected security incident or to request a copy of this policy: **support@veradicai.com**.

For responsible disclosure of vulnerabilities, see Veradic's Trust & Security page at https://veradicai.com/trust.
