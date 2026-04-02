# Plan: Schools Cleanup + Leads Pipeline

## Overview

Three related improvements to the admin dashboard: clean up the Schools page, connect leads to schools, and add pipeline filtering to Leads.

## 1. Add school_id to contact_leads (backend)

- Migration: add school_id FK (nullable, SET NULL on delete) to contact_leads
- Extend UpdateLeadStatusRequest to accept optional school_id
- Include school_id in leads list API response

## 2. Remove Students from Schools page, add Notes column

- Remove "Students" column and stat card from Schools page
- Add "Notes" column (truncated with tooltip)
- Stat cards: Total Schools, Active, Teachers (3 cards)
- Remove student_count from API response and dashboard types

Column layout (8 cols):
| School | Contact | Teachers | Status | Notes | Updated | Added | Actions |
|--------|---------|----------|--------|-------|---------|-------|---------|
| 18%    | 18%     | 8%       | 9%     | 13%   | 13%     | 12%   | 9%      |

## 3. Add Active/All filter to Leads + school link

- Toggle above Leads table: Active (default) | All
- Active: new + contacted only. All: everything.
- Pill-style toggle matching LLM Calls "All / Failures" tabs
- Stat cards always show full counts (not filtered)
- Converted leads with school_id show "View School →" link
- Convert modal passes school_id when updating lead status

## 5. Prevent duplicate school conversion

- Before creating a school during lead conversion, check if a school with that contact email already exists
- If it does, show error: "A school with this email already exists"
- This prevents accidentally creating duplicate schools

## Edge cases

- Legacy converted leads: no school_id, show "Converted" without link
- School deleted: FK SET NULL, lead loses link gracefully (delete = undo a mistake)
- School deactivated: lead still shows link, admin sees inactive status
- Empty Active filter: show "No active leads" with hint to switch to All
- Duplicate conversion blocked: check contact email against existing schools

## 4. Editable school detail modal

- Add "Edit" button to school detail modal header
- Clicking it switches display fields to input fields (inline editing)
- Editable fields: name, contact name, contact email, city, state, notes (textarea)
- Save calls PATCH /admin/schools/{id} (already exists)
- Cancel reverts to display mode
- All edits auto-tracked via audit columns (already wired up)

## Commits (~5 commits)

1. feat: add school_id to contact_leads model + migration
2. feat: pass school_id on lead conversion
3. fix: remove Students from Schools page, add Notes column
4. feat: add editable school detail modal
5. feat: add Active/All filter to Leads with school link
