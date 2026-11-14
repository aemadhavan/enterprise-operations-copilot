-- 002_runtime: governed draft, execution, approval workflow and append-only audit tables
-- (FR-009, FR-010, FR-015, FR-024, FR-024a, FR-026, Constitution II & IV).

CREATE SEQUENCE IF NOT EXISTS access_request_seq START 1;
CREATE SEQUENCE IF NOT EXISTS onboarding_ticket_seq START 1;

CREATE TABLE drafts (
  draft_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lineage_id       uuid NOT NULL,
  version          int NOT NULL CHECK (version >= 1),
  kind             text NOT NULL CHECK (kind IN ('access_request', 'onboarding_ticket')),
  payload          jsonb NOT NULL,
  approval_chain   jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings         jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_citations text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed', 'confirmed', 'cancelled', 'superseded')),
  conversation_id  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lineage_id, version)
);

CREATE INDEX drafts_lineage_id ON drafts (lineage_id);
CREATE INDEX drafts_conversation_id ON drafts (conversation_id);

-- Enforce terminal states on drafts: only 'proposed' may transition to another state.
CREATE OR REPLACE FUNCTION check_draft_status_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> NEW.status AND OLD.status <> 'proposed' THEN
    RAISE EXCEPTION 'Invalid draft status transition from % to % (draft_id=%)',
      OLD.status, NEW.status, OLD.draft_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER drafts_status_transition_trg
BEFORE UPDATE OF status ON drafts
FOR EACH ROW EXECUTE FUNCTION check_draft_status_transition();

CREATE TABLE access_requests (
  request_id        text PRIMARY KEY
                    DEFAULT ('AR-' || lpad(nextval('access_request_seq')::text, 4, '0')),
  draft_id          uuid NOT NULL UNIQUE REFERENCES drafts(draft_id),
  payload           jsonb NOT NULL,
  sla_business_days int NOT NULL DEFAULT 5 CHECK (sla_business_days IN (2, 5)),
  status            text NOT NULL DEFAULT 'pending_approvals'
                    CHECK (status IN ('pending_approvals', 'approved', 'rejected', 'expired')),
  workflow_run_id   text,
  confirmed_by      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE onboarding_tickets (
  ticket_id                   text PRIMARY KEY
                              DEFAULT ('TKT-' || lpad(nextval('onboarding_ticket_seq')::text, 4, '0')),
  draft_id                    uuid NOT NULL UNIQUE REFERENCES drafts(draft_id),
  contractor_name             text NOT NULL,
  vendor                      text,
  sponsor                     text NOT NULL,
  start_date                  date NOT NULL,
  end_date                    date NOT NULL,
  restricted_access_expected  boolean NOT NULL DEFAULT false,
  vendor_flag                 jsonb,
  status                      text NOT NULL DEFAULT 'open' CHECK (status IN ('open')),
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approval_steps (
  id            bigserial PRIMARY KEY,
  request_id    text NOT NULL REFERENCES access_requests(request_id) ON DELETE CASCADE,
  seq           int NOT NULL CHECK (seq >= 1),
  role          text NOT NULL CHECK (role IN (
                  'sponsor',
                  'line_manager',
                  'data_owner',
                  'security_governance',
                  'head_of_security_governance',
                  'privacy_officer',
                  'finance_systems_lead'
                )),
  approver_name text,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'sla_breached')),
  decided_at    timestamptz,
  decided_via   text CHECK (decided_via IS NULL OR decided_via = 'simulated_approver_panel'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, seq)
);

CREATE INDEX approval_steps_request_id ON approval_steps (request_id, seq);

CREATE TABLE audit_log (
  id               bigserial PRIMARY KEY,
  at               timestamptz NOT NULL DEFAULT now(),
  actor            text NOT NULL,
  event            text NOT NULL CHECK (event IN (
                     'proposed',
                     'blocked',
                     'superseded',
                     'cancelled',
                     'confirmed',
                     'executed',
                     'step_approved',
                     'step_rejected',
                     'sla_breached',
                     'request_completed'
                   )),
  draft_id         uuid REFERENCES drafts(draft_id),
  request_id       text REFERENCES access_requests(request_id),
  ticket_id        text REFERENCES onboarding_tickets(ticket_id),
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_citations text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_draft_id   ON audit_log (draft_id);
CREATE INDEX audit_log_request_id ON audit_log (request_id);
CREATE INDEX audit_log_at_desc    ON audit_log (at DESC, id DESC);

REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

CREATE OR REPLACE FUNCTION forbid_audit_log_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted (Constitution IV)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_append_only_trg
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION forbid_audit_log_mutation();
