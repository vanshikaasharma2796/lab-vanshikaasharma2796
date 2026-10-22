---
policy: privacy-and-residency
name: Privacy, residency and retention
owner: Data Governance
applies_to: [knowledge pages, work threads, question text, answer log]
---

- Personal data is masked wherever it appears: in the question, in a retrieved snippet and in the answer. An email keeps its first letter and its domain (j***@example.com); a phone number keeps its last four digits (***-***-0182); a card number keeps its last four.
- A question that asks for personal data in bulk (every customer's email, all phone numbers) is blocked, not masked.
- Residency: this deployment serves the US. Content held in another region (the EU overflow call-centre transcripts) is never retrieved here, whatever its relevance.
- Retention: each source keeps content for the days set on it in `context/sources.json`. Anything older is not retrieved, and the answer log is purged on the schedule set in `src/config.js` (`engine.retention.logDays`).
- Access: a page or thread is shown only to the roles or people on its access list and on its source's. A franchise operator never sees a page or thread about another operator.
- Drafts are not retrieved. Only approved knowledge pages are context.
