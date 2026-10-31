"""Persistence model. Datetimes are naive UTC; `reporting_date` columns are Asia/Kolkata dates."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import (JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text,
                        UniqueConstraint, Index)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.timeutil import utcnow


# --------------------------------------------------------------------------- registry
class Division(Base):
    __tablename__ = "divisions"
    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    summary_label_mr: Mapped[str] = mapped_column(String(200))
    section_title_mr: Mapped[str] = mapped_column(String(200))
    show_subtotal: Mapped[bool] = mapped_column(Boolean, default=True)
    detail_page: Mapped[int] = mapped_column(Integer, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    offices: Mapped[list["Office"]] = relationship(back_populates="division", order_by="Office.sort_order")


class Office(Base):
    __tablename__ = "offices"
    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    division_code: Mapped[str] = mapped_column(ForeignKey("divisions.code"))
    name_mr: Mapped[str] = mapped_column(String(200))
    name_en: Mapped[str] = mapped_column(String(200), default="")
    kind: Mapped[str] = mapped_column(String(32), default="district")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    division: Mapped[Division] = relationship(back_populates="offices")


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("platform", "handle_key", name="uq_account_platform_handle"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    platform: Mapped[str] = mapped_column(String(32))
    handle: Mapped[str] = mapped_column(String(200))
    handle_key: Mapped[str] = mapped_column(String(200))  # lower-cased, '@' stripped
    url: Mapped[str] = mapped_column(String(500))
    display_name: Mapped[str] = mapped_column(String(200), default="")
    office_code: Mapped[Optional[str]] = mapped_column(ForeignKey("offices.code"), nullable=True)
    mapping_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    mapping_note: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    external_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)  # e.g. YouTube channel id
    provider_meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # e.g. uploads playlist id
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    office: Mapped[Optional[Office]] = relationship()


# --------------------------------------------------------------------------- campaigns
class Campaign(Base):
    __tablename__ = "campaigns"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    title_mr: Mapped[str] = mapped_column(String(300))
    title_en: Mapped[str] = mapped_column(String(300), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    rules: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    count_rules: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_by: Mapped[str] = mapped_column(String(200), default="system")
    # Older databases also carry entry_open / entry_start / entry_end columns here (the office-entry window
    # from before forms); app.forms.migrate reads them once, nothing else uses them.


# --------------------------------------------------------------------------- users / sessions
class User(Base):
    """role: district (own office: fills the forms it receives) | zone (reads its division, never writes) |
    state (everything)."""
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    display_name: Mapped[str] = mapped_column(String(200), default="")
    role: Mapped[str] = mapped_column(String(20))
    office_code: Mapped[Optional[str]] = mapped_column(ForeignKey("offices.code"), nullable=True)
    division_code: Mapped[Optional[str]] = mapped_column(ForeignKey("divisions.code"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    office: Mapped[Optional[Office]] = relationship()
    division: Mapped[Optional[Division]] = relationship()


class UserSession(Base):
    """Login session; only the SHA-256 of the cookie token is stored."""
    __tablename__ = "user_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    user: Mapped[User] = relationship()


# --------------------------------------------------------------------------- office data entry
class OfficeEntry(Base):
    """Legacy (before forms): one office × campaign × day × report column. app.forms.migrate copies these into
    forms; the table is kept untouched as a backup and nothing writes to it any more."""
    __tablename__ = "office_entries"
    __table_args__ = (UniqueConstraint("campaign_id", "office_code", "entry_date", "column_key",
                                       name="uq_office_entry"),
                      Index("ix_office_entry_campaign_date", "campaign_id", "entry_date"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"))
    office_code: Mapped[str] = mapped_column(ForeignKey("offices.code"))
    entry_date: Mapped[date] = mapped_column(Date)
    column_key: Mapped[str] = mapped_column(String(40))
    value: Mapped[int] = mapped_column(Integer)
    entered_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    entered_by: Mapped[str] = mapped_column(String(200), default="")  # username, or e.g. "import:xlsx"
    entered_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    note: Mapped[str] = mapped_column(Text, default="")


# --------------------------------------------------------------------------- forms (अहवाल फॉर्म)
class Form(Base):
    """A report form the state admin defines and sends to offices. frequency daily|weekly|once sets the periods
    offices fill in; status draft|published|paused|archived sets who sees it (offices see the live and paused
    forms they receive; only live (published) forms accept entries)."""
    __tablename__ = "forms"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    title_mr: Mapped[str] = mapped_column(String(300))
    title_en: Mapped[str] = mapped_column(String(300), default="")
    instructions_mr: Mapped[str] = mapped_column(Text, default="")
    instructions_en: Mapped[str] = mapped_column(Text, default="")
    frequency: Mapped[str] = mapped_column(String(10), default="daily")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    deadline_hours: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # after the period's last day
    status: Mapped[str] = mapped_column(String(12), default="draft")
    entry_open: Mapped[bool] = mapped_column(Boolean, default=True)  # unused: pausing is now status "paused"
    campaign_id: Mapped[Optional[int]] = mapped_column(ForeignKey("campaigns.id"), nullable=True)
    created_by: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    fields: Mapped[list["FormField"]] = relationship(back_populates="form", order_by="FormField.sort_order",
                                                     cascade="all, delete-orphan")
    recipients: Mapped[list["FormRecipient"]] = relationship(cascade="all, delete-orphan")


class FormField(Base):
    """One question. type number|text|yesno|choice|date; numbers with aggregate=sum are the roll-up columns.
    Once a value is stored the field is locked: it can be renamed, reordered or archived, never deleted or
    retyped, so old answers keep their meaning."""
    __tablename__ = "form_fields"
    __table_args__ = (UniqueConstraint("form_id", "key", name="uq_form_field_key"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"), index=True)
    key: Mapped[str] = mapped_column(String(40))
    label_mr: Mapped[str] = mapped_column(String(300))
    label_en: Mapped[str] = mapped_column(String(300), default="")
    help_mr: Mapped[str] = mapped_column(Text, default="")
    help_en: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(String(10), default="number")
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    options: Mapped[list[str]] = mapped_column(JSON, default=list)
    min_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    integer: Mapped[bool] = mapped_column(Boolean, default=True)  # numbers: whole numbers only
    group: Mapped[str] = mapped_column(String(40), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    aggregate: Mapped[str] = mapped_column(String(10), default="sum")  # sum | none
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    form: Mapped[Form] = relationship(back_populates="fields")


class FormRecipient(Base):
    __tablename__ = "form_recipients"
    __table_args__ = (UniqueConstraint("form_id", "office_code", name="uq_form_recipient"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"), index=True)
    office_code: Mapped[str] = mapped_column(ForeignKey("offices.code"))


class FormSubmission(Base):
    """One office's answers for one period. status draft|submitted|returned. The office may keep changing a sent
    period and the admin edits submitted values directly; every change after sending is a FormValueEdit."""
    __tablename__ = "form_submissions"
    __table_args__ = (UniqueConstraint("form_id", "office_code", "period_start", name="uq_form_submission"),
                      Index("ix_form_submission_form_period", "form_id", "period_start"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"))
    office_code: Mapped[str] = mapped_column(ForeignKey("offices.code"))
    period_start: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(12), default="draft")
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    submitted_by: Mapped[str] = mapped_column(String(200), default="")
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reviewed_by: Mapped[str] = mapped_column(String(200), default="")
    review_note: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(Text, default="")  # the office's own note
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    values: Mapped[list["FormValue"]] = relationship(back_populates="submission", cascade="all, delete-orphan")
    edits: Mapped[list["FormValueEdit"]] = relationship(cascade="all, delete-orphan", order_by="FormValueEdit.id")


class FormValue(Base):
    """One answer. A missing row means 'not entered' — never zero; 0 is stored only when the office confirmed
    zeros. An admin correction keeps the office's original value beside the corrected one."""
    __tablename__ = "form_values"
    __table_args__ = (UniqueConstraint("submission_id", "field_id", name="uq_form_value"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("form_submissions.id"), index=True)
    field_id: Mapped[int] = mapped_column(ForeignKey("form_fields.id"), index=True)
    value_num: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    value_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    entered_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    entered_by: Mapped[str] = mapped_column(String(200), default="")
    entered_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    original_value_num: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    original_value_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    corrected_by: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    corrected_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    correction_note: Mapped[str] = mapped_column(Text, default="")
    submission: Mapped[FormSubmission] = relationship(back_populates="values")
    field: Mapped[FormField] = relationship()


class FormValueEdit(Base):
    """One change to a value after its period was sent, never changed or deleted: the value before and after, who,
    when and why. source is "state" (an admin correction) or "office" (the office changing its own figure). An undo
    is a new edit back to an earlier value, pointing at the edit it reverts."""
    __tablename__ = "form_value_edits"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("form_submissions.id"), index=True)
    field_id: Mapped[int] = mapped_column(ForeignKey("form_fields.id"))
    before_num: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    before_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    after_num: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    after_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    by: Mapped[str] = mapped_column(String(200))
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    note: Mapped[str] = mapped_column(Text, default="")
    reverts_id: Mapped[Optional[int]] = mapped_column(ForeignKey("form_value_edits.id"), nullable=True)
    source: Mapped[str] = mapped_column(String(10), default="state")
    field: Mapped[FormField] = relationship()


class AnalyticsBrief(Base):
    """The analytics page's daily brief, cached per form, day, reader scope and language so it is written at
    most once a day per scope. source is "ai" (model wording, numbers substituted by code) or "template"."""
    __tablename__ = "analytics_briefs"
    __table_args__ = (UniqueConstraint("form_id", "day", "scope", "lang", name="uq_analytics_brief"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"), index=True)
    day: Mapped[date] = mapped_column(Date)
    scope: Mapped[str] = mapped_column(String(120))  # "state" | "division:<code>" | "office:<code>"
    lang: Mapped[str] = mapped_column(String(4), default="mr")
    text: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(12), default="template")
    facts: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    reason: Mapped[str] = mapped_column(Text, default="")  # why the template was used, when it was
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# --------------------------------------------------------------------------- collection
class CollectionRun(Base):
    __tablename__ = "collection_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[Optional[int]] = mapped_column(ForeignKey("campaigns.id"), nullable=True)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    window_start_utc: Mapped[datetime] = mapped_column(DateTime)
    window_end_utc: Mapped[datetime] = mapped_column(DateTime)
    overlap_hours: Mapped[int] = mapped_column(Integer, default=6)
    mode: Mapped[str] = mapped_column(String(20), default="window")  # window | incremental
    status: Mapped[str] = mapped_column(String(20), default="queued")
    # queued | running | completed | partial | failed | interrupted
    trigger_source: Mapped[str] = mapped_column(String(30), default="manual")
    triggered_by: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    tasks: Mapped[list["CollectionTask"]] = relationship(back_populates="run", order_by="CollectionTask.id")


class CollectionTask(Base):
    """One account × platform collection inside a run."""
    __tablename__ = "collection_tasks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("collection_runs.id"))
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    platform: Mapped[str] = mapped_column(String(32))
    provider: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    # pending | running | complete | partial | failed | skipped
    requested_start_utc: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    requested_end_utc: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    window_complete: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    coverage_note: Mapped[str] = mapped_column(Text, default="")
    pages_fetched: Mapped[int] = mapped_column(Integer, default=0)
    items_received: Mapped[int] = mapped_column(Integer, default=0)
    items_in_window: Mapped[int] = mapped_column(Integer, default=0)
    items_new: Mapped[int] = mapped_column(Integer, default=0)
    items_updated: Mapped[int] = mapped_column(Integer, default=0)
    items_unparseable: Mapped[int] = mapped_column(Integer, default=0)
    requests_made: Mapped[int] = mapped_column(Integer, default=0)
    usage: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    resume_state: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    progress_message: Mapped[str] = mapped_column(Text, default="")
    error_kind: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    run: Mapped[CollectionRun] = relationship(back_populates="tasks")
    account: Mapped[Account] = relationship()


class CoverageInterval(Base):
    """A UTC interval for which an account's publications were fully collected."""
    __tablename__ = "coverage_intervals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    start_utc: Mapped[datetime] = mapped_column(DateTime)
    end_utc: Mapped[datetime] = mapped_column(DateTime)
    task_id: Mapped[int] = mapped_column(ForeignKey("collection_tasks.id"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class RawRecord(Base):
    """Provider response item exactly as received (kept separately from the normalised model)."""
    __tablename__ = "raw_records"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("collection_tasks.id"), index=True)
    provider: Mapped[str] = mapped_column(String(64))
    platform: Mapped[str] = mapped_column(String(32))
    external_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    payload_sha256: Mapped[str] = mapped_column(String(64))
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Publication(Base):
    __tablename__ = "publications"
    __table_args__ = (
        UniqueConstraint("platform", "platform_post_id", name="uq_publication_platform_id"),
        Index("ix_publication_reporting_date", "reporting_date"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    platform: Mapped[str] = mapped_column(String(32))
    platform_post_id: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str] = mapped_column(String(64))
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    author_handle: Mapped[str] = mapped_column(String(200), default="")
    url: Mapped[str] = mapped_column(String(1000), default="")
    published_at_utc: Mapped[datetime] = mapped_column(DateTime)
    reporting_date: Mapped[date] = mapped_column(Date)
    text: Mapped[str] = mapped_column(Text, default="")
    title: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    content_type: Mapped[str] = mapped_column(String(40), default="post")
    is_repost: Mapped[bool] = mapped_column(Boolean, default=False)
    is_reply: Mapped[bool] = mapped_column(Boolean, default=False)
    is_quote: Mapped[bool] = mapped_column(Boolean, default=False)
    is_pinned: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    is_short: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    media: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # values may be null: never coerced to 0
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    metrics_observed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    office_code: Mapped[Optional[str]] = mapped_column(ForeignKey("offices.code"), nullable=True)
    first_collected_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_collected_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    first_run_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_run_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    latest_raw_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    provenance: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    account: Mapped[Account] = relationship()


class PublicationAlias(Base):
    """Alternative keys (canonical URL, other provider IDs) that resolve to one publication,
    so the same reel/video returned by several endpoints is stored once per platform."""
    __tablename__ = "publication_aliases"
    __table_args__ = (UniqueConstraint("platform", "alias_key", name="uq_alias"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    platform: Mapped[str] = mapped_column(String(32))
    alias_key: Mapped[str] = mapped_column(String(1000))
    publication_id: Mapped[int] = mapped_column(ForeignKey("publications.id"), index=True)


# --------------------------------------------------------------------------- classification / review
class Classification(Base):
    __tablename__ = "classifications"
    __table_args__ = (UniqueConstraint("publication_id", "campaign_id", name="uq_classification"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    publication_id: Mapped[int] = mapped_column(ForeignKey("publications.id"), index=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), index=True)
    auto_decision: Mapped[str] = mapped_column(String(30))  # match | no_match | needs_review | insufficient_text
    auto_score: Mapped[float] = mapped_column(Float, default=0.0)
    auto_evidence: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    classifier: Mapped[str] = mapped_column(String(64))
    classifier_version: Mapped[str] = mapped_column(String(32))
    rules_version: Mapped[int] = mapped_column(Integer)
    classified_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    manual_decision: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # include | exclude
    manual_note: Mapped[str] = mapped_column(Text, default="")
    manual_by: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    manual_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    report_tag: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)  # video_bite | video_interview
    publication: Mapped[Publication] = relationship()

    @property
    def effective_decision(self) -> str:
        """include | exclude | pending."""
        if self.manual_decision in ("include", "exclude"):
            return self.manual_decision
        return {"match": "include", "no_match": "exclude"}.get(self.auto_decision, "pending")


# --------------------------------------------------------------------------- reporting
class ManualInput(Base):
    """Operator-entered value for one office × report column × period. Absence of a row means
    'not entered' (missing) — never zero. value == 0 is only stored when the operator explicitly
    confirms zero."""
    __tablename__ = "manual_inputs"
    __table_args__ = (UniqueConstraint("campaign_id", "period_start", "period_end", "office_code", "column_key",
                                       name="uq_manual_input"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[Optional[int]] = mapped_column(ForeignKey("campaigns.id"), nullable=True)  # None: no search term
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    office_code: Mapped[str] = mapped_column(ForeignKey("offices.code"))
    column_key: Mapped[str] = mapped_column(String(40))
    value: Mapped[int] = mapped_column(Integer)
    confirmed_zero: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str] = mapped_column(Text, default="")
    entered_by: Mapped[str] = mapped_column(String(200))
    entered_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ReportSnapshot(Base):
    __tablename__ = "report_snapshots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[Optional[int]] = mapped_column(ForeignKey("campaigns.id"), nullable=True)  # None: no search term
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(20))  # draft | final
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_by: Mapped[str] = mapped_column(String(200))
    note: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    data_sha256: Mapped[str] = mapped_column(String(64))
    pdf_path: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    pdf_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    superseded_by_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    actor: Mapped[str] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(80))
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str] = mapped_column(String(100))
    before: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    after: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
