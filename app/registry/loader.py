"""Loads the organisational registry, initial accounts and campaigns from config/ into the DB.

Organisation: synced on every start (YAML is the source of truth; removed offices become inactive).
Accounts / campaigns: inserted only if absent — afterwards they are edited in the UI (audited)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.models import Account, Campaign, Division, Office


def handle_key(handle: str) -> str:
    return handle.strip().lstrip("@").lower()


def load_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def sync_organisation(session: Session, path: Path) -> None:
    data = load_yaml(path)
    seen_div, seen_off = set(), set()
    for d_idx, d in enumerate(data["divisions"]):
        div = session.get(Division, d["code"]) or Division(code=d["code"])
        div.summary_label_mr = d["summary_label_mr"]
        div.section_title_mr = d.get("section_title_mr", d["summary_label_mr"])
        div.show_subtotal = bool(d.get("show_subtotal", True))
        div.detail_page = int(d.get("detail_page", 1))
        div.sort_order, div.active = d_idx, True
        session.add(div)
        seen_div.add(div.code)
        for o_idx, o in enumerate(d["offices"]):
            off = session.get(Office, o["code"]) or Office(code=o["code"])
            off.division_code, off.name_mr = div.code, o["name_mr"]
            off.name_en, off.kind = o.get("name_en", ""), o.get("kind", "district")
            off.sort_order, off.active = o_idx, True
            session.add(off)
            seen_off.add(off.code)
    for div in session.scalars(select(Division)).all():
        if div.code not in seen_div:
            div.active = False
    for off in session.scalars(select(Office)).all():
        if off.code not in seen_off:
            off.active = False
    session.flush()


def seed_accounts(session: Session, path: Path) -> int:
    n = 0
    for a in (load_yaml(path) or {}).get("accounts", []):
        key = handle_key(a["handle"])
        if session.scalar(select(Account).where(Account.platform == a["platform"], Account.handle_key == key)):
            continue
        acc = Account(platform=a["platform"], handle=a["handle"], handle_key=key, url=a["url"],
                      display_name=a.get("display_name", ""), office_code=a.get("office_code"),
                      mapping_confirmed=bool(a.get("mapping_confirmed", False)),
                      mapping_note=a.get("mapping_note", ""), active=True, provider_meta={})
        session.add(acc)
        session.flush()
        audit.record(session, "system:seed", "account.seed", "account", acc.id,
                     after={"platform": acc.platform, "handle": acc.handle, "office": acc.office_code,
                            "mapping_confirmed": acc.mapping_confirmed})
        n += 1
    return n


def seed_campaigns(session: Session, directory: Path) -> int:
    n = 0
    for path in sorted(directory.glob("*.yaml")):
        c = load_yaml(path)
        if session.scalar(select(Campaign).where(Campaign.slug == c["slug"])):
            continue
        camp = Campaign(slug=c["slug"], title_mr=c["title_mr"], title_en=c.get("title_en", ""),
                        description=c.get("description", ""), rules=c.get("rules", {}),
                        count_rules=c.get("count_rules", {}), version=1, updated_by="system:seed")
        session.add(camp)
        session.flush()
        audit.record(session, "system:seed", "campaign.seed", "campaign", camp.id, after={"slug": camp.slug})
        n += 1
    return n


def bootstrap(session: Session, config_dir: Path) -> None:
    sync_organisation(session, config_dir / "organisation.yaml")
    seed_accounts(session, config_dir / "accounts.yaml")
    seed_campaigns(session, config_dir / "campaigns")
    session.commit()


def report_format(config_dir: Path) -> dict[str, Any]:
    return load_yaml(config_dir / "report_format.yaml")
