# Surgiassist BDM CRM — PRD

## Original problem
Enterprise BDM CRM for "Surgiassist": light clinical-blue glassmorphism UI with 3D tilt cards and smooth animations; live sync from a public Google Sheet CSV every 5 min with a navbar countdown; secure login with RBAC (Master Owner, Manager, BDM); Treatment Normalization Engine; Leads & Pipeline with a single exact-date filter; BDM allocation rules (quotas + treatment priority); follow-ups with due/overdue per BDM; notes, timeline, export, reminders, audit log.

## Architecture
- Backend: FastAPI (`server.py`, `normalize.py`), MongoDB (motor). Bearer JWT (12h), bcrypt, 5-fail/15-min lockout, seeded users from .env.
- Sync: background loop fetches the sheet CSV, normalizes rows and upserts by Lead ID. CRM-edited fields (`edited_fields`) are never overwritten by the sheet. A manual sync restarts the 5-min timer.
- Frontend: React + react-router, framer-motion, recharts, shadcn (sheet, popover, dialog, tabs, switch), sonner.

## Implemented (2026-11-18)
- Login (role comes from the account), RBAC routes and APIs, BDM sees only their own leads
- Navbar live sync countdown ring + Sync-now button (admins), notifications bell (overdue, due today, reminders)
- Overview: KPIs, created-on date picker, 14-day trend, treatment mix, stage breakdown, BDM leaderboard
- Leads: search, single date, treatment, stage and BDM filters, pagination, CSV export, lead drawer (stage/BDM/follow-up edit, notes, reminders, timeline)
- Follow-ups: date picker, overdue/due/upcoming counts, per-BDM breakdown, tabs, mark done
- Allocation: per-BDM active switch, daily quota, ordered treatment priorities, auto-assign after sync, run now
- Treatment Engine: keyword rules editor, live tester, raw→canonical mapping, re-normalize on save
- Team & Access (owner/manager rules), Audit log

## Iteration 2 (2026-11-18)
- Office day: leads 18:00–23:59 count for the next day (office_date); midnight–18:00 the same day. Leads filter, overview and trend use office_date
- Overview day breakdown: arrived, assigned per BDM, unassigned, from previous evening
- Attendance (rotational offs) per date; allocation skips off BDMs. Platform cron 9:55 IST = sync + auto-allocation
- WhatsApp digest at 10:00 IST via cron. MOCKED: messages stored in whatsapp_outbox, not sent (provider not connected)
- Campaign conversion report (treatment × campaign code); follow-up Done dialog with next date + note; self-service password change; BDM WhatsApp numbers in Team

## Iteration 3 (2026-11-18)
- Overview period picker: Today (default) / This week (Mon–Sun) / This month / This year / All time / Pick date (date input only when chosen); period kept in URL
- KPIs, assignment breakdown, treatment mix, pipeline stages, BDM leaderboard and trend all filtered by period (office_date). Due/overdue cards are live, labelled
- Sync reads the follow-up column by position if its header is blank in the sheet

## Backlog
- P0: Connect a WhatsApp provider (Twilio or Meta) to actually send the digest
- P1: shadcn Calendar/Select instead of native inputs
- P1: More stable identity for sheet rows without a Lead ID; clean up activity for leads removed from the sheet
- P2: Password reset, per-user password change, WhatsApp/email reminders, conversion analytics by campaign variant
