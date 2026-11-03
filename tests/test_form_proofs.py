"""Proof of work on report forms: link parsing and canonical form, the links-count rule, link checks (platform,
repeats, already counted), file uploads through the local backend, the district submit block, exempt periods,
file access per role, soft removal with audit, responses and the Excel पुरावा sheet, and the S3 backend with a
stubbed client."""
from __future__ import annotations

import io
from datetime import timedelta

import pytest
from openpyxl import load_workbook
from sqlalchemy import select

from app.forms import proof as P
from app.models import AuditLog, FormProof
from app.timeutil import today_ist
from tests.conftest import make_user

TODAY = today_ist()
EARLIER = TODAY - timedelta(days=1)
FB = [f"https://www.facebook.com/dio.solapur/posts/{i}?mibextid=abc{i}" for i in range(1, 5)]


# --------------------------------------------------------------------------- link helpers
def test_extract_links_from_a_whatsapp_message():
    text = ("आजच्या पोस्ट: https://www.facebook.com/a/posts/1, आणि www.facebook.com/a/posts/2.\n"
            "(https://fb.watch/xyz) — पहा!")
    assert P.extract_links(text) == ["https://www.facebook.com/a/posts/1", "https://www.facebook.com/a/posts/2",
                                     "https://fb.watch/xyz"]
    assert P.extract_links("कोणतीही लिंक नाही") == []


def test_canonical_makes_variants_equal():
    same = ["https://www.facebook.com/a/posts/1?mibextid=xyz", "http://m.facebook.com/a/posts/1/",
            "https://facebook.com/a/posts/1#comments", "https://facebook.com/a/posts/1?utm_source=wa&fbclid=1"]
    assert {P.canonical(u) for u in same} == {"facebook.com/a/posts/1"}
    assert P.canonical("https://twitter.com/dio/status/9?s=20") == P.canonical("https://x.com/dio/status/9")
    yt = {P.canonical(u) for u in ("https://youtu.be/AbC?si=q", "https://www.youtube.com/watch?v=AbC&feature=share",
                                   "https://youtube.com/shorts/AbC", "https://m.youtube.com/watch?v=AbC&t=30")}
    assert yt == {"youtube.com/watch?v=AbC"}
    assert P.canonical("https://x.com/a?b=2&a=1") == "x.com/a?a=1&b=2"


def test_link_problem_by_platform():
    from app.models import FormField
    fb, yt, blog = FormField(key="facebook"), FormField(key="youtube"), FormField(key="blog")
    assert P.link_problem(fb, "https://m.facebook.com/a/posts/1") is None
    assert P.link_problem(fb, "https://fb.watch/x") is None
    assert P.link_problem(fb, "https://www.instagram.com/p/1") == "wrong_platform"
    assert P.link_problem(yt, "https://youtu.be/AbC") is None
    assert P.link_problem(yt, "https://example.com/v") == "wrong_platform"
    assert P.link_problem(blog, "https://dio-solapur.blogspot.com/2026/11/x.html") is None
    assert P.link_problem(blog, "ftp://x.com/a") == "not_link"


# --------------------------------------------------------------------------- web setup
FIELDS = [{"key": "facebook", "label_mr": "फेसबुक", "type": "number", "proof": "links"},
          {"key": "instagram", "label_mr": "इन्सटाग्राम", "type": "number", "proof": "links"},
          {"key": "clippings", "label_mr": "कात्रणे", "type": "number", "proof": "files"},
          {"key": "activities", "label_mr": "उपक्रम", "type": "number", "proof": "either"},
          {"key": "meetings", "label_mr": "बैठका", "type": "number"}]


def new_form(admin_client, recipients=("solapur", "satara", "pune", "nashik")):
    body = {"title_mr": "पुरावा चाचणी", "frequency": "daily", "start_date": (TODAY - timedelta(days=5)).isoformat(),
            "recipients": list(recipients), "fields": [{"label_mr": "नोंद", "type": "number"}]}
    f = admin_client.post("/api/forms", json=body).json()
    assert f["proof_from"] is None  # no field asks for proof yet
    r = admin_client.put(f"/api/forms/{f['id']}", json={"fields": [{**FIELDS[0]}, *FIELDS[1:]]})
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["proof_from"] == TODAY.isoformat()
    assert {x["key"]: x["proof"] for x in f["fields"]}["clippings"] == "files"
    assert admin_client.post(f"/api/forms/{f['id']}/publish").json()["status"] == "published"
    return f


@pytest.fixture(scope="module")
def pform(admin_client):
    return new_form(admin_client)


@pytest.fixture(scope="module")
def solapur(web, admin_client):
    return make_user(admin_client, web, "prf_solapur", "district", office="solapur")


@pytest.fixture(scope="module")
def satara(web, admin_client):
    return make_user(admin_client, web, "prf_satara", "district", office="satara")


@pytest.fixture(scope="module")
def pune(web, admin_client):
    return make_user(admin_client, web, "prf_pune", "district", office="pune")


@pytest.fixture(scope="module")
def zone_pune(web, admin_client):
    return make_user(admin_client, web, "prf_zone_pune", "zone", division="pune")


@pytest.fixture(scope="module")
def zone_nashik(web, admin_client):
    return make_user(admin_client, web, "prf_zone_nashik", "zone", division="nashik")


@pytest.fixture
def entry_open(monkeypatch):
    from datetime import datetime
    from app.forms import service as svc
    monkeypatch.setattr(svc, "entry_closes", lambda form, ps: datetime.max)


def url(form, office, day, action=""):
    return f"/api/forms/{form['id']}/submissions/{office}/{day.isoformat()}" + (f"/{action}" if action else "")


def put(client, form, office, day, values=None, proofs=None, **kw):
    return client.put(url(form, office, day), json={"values": values or {}, "proofs": proofs, "confirm_zero": True, **kw})


def upload(client, form, office, day, field, data: bytes, ctype="application/pdf", name="पुरावा.pdf"):
    r = client.post(url(form, office, day, "uploads"), json={"field": field, "name": name, "type": ctype, "size": len(data)})
    assert r.status_code == 200, r.text
    up = r.json()
    assert up["key"].startswith(f"proofs/{form['id']}/{office}/{day.isoformat()}/")
    r = client.put(up["url"], content=data, headers=up["headers"])
    assert r.status_code == 200, r.text
    return {"key": up["key"], "name": name, "type": ctype, "size": len(data)}


# --------------------------------------------------------------------------- links
def test_links_set_the_number(pform, solapur, web):
    r = put(solapur, pform, "solapur", TODAY, {"facebook": 99}, {"facebook": {"links": FB}})
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["values"]["facebook"] == 4 and [p["url"] for p in got["proofs"]["facebook"]] == FB
    assert got["proof_exempt"] is False and got["proof_missing"] == []
    # removing one: 3, the removed row stays on record, soft-deleted with an audit entry
    got = put(solapur, pform, "solapur", TODAY, {}, {"facebook": {"links": FB[:3]}}).json()
    assert got["values"]["facebook"] == 3 and len(got["proofs"]["facebook"]) == 3
    with web.SessionF() as s:
        gone = s.scalars(select(FormProof).where(FormProof.url == FB[3])).one()
        assert gone.removed_at is not None and gone.removed_by == "prf_solapur"
        acts = [a.action for a in s.scalars(select(AuditLog).where(
            AuditLog.entity_id == f"{pform['id']}:solapur:{TODAY}", AuditLog.action.like("form_proof.%"))).all()]
    assert acts.count("form_proof.add") == 4 and acts.count("form_proof.remove") == 1
    # a pasted WhatsApp message: only the links are kept
    blob = "आजच्या पोस्ट: https://www.instagram.com/p/AAA/?igsh=x आणि https://instagram.com/p/BBB पहा"
    got = put(solapur, pform, "solapur", TODAY, {}, {"instagram": {"links": [blob]}}).json()
    assert got["values"]["instagram"] == 2
    # the number of a links field can't be typed: no links and no "none today" tick stores blank, the tick stores 0
    got = put(solapur, pform, "solapur", TODAY, {"instagram": 5}, {"instagram": {"links": []}}).json()
    assert got["values"]["instagram"] is None
    got = put(solapur, pform, "solapur", TODAY, {"instagram": 0}, {"instagram": {"links": []}}).json()
    assert got["values"]["instagram"] == 0
    assert put(solapur, pform, "solapur", TODAY, {"facebook": 10}).json()["values"]["facebook"] == 3


def test_link_checks(admin_client, solapur, satara, entry_open):
    form = new_form(admin_client)
    bad = put(solapur, form, "solapur", TODAY, {}, {"facebook": {"links": [FB[0], "https://www.instagram.com/p/1"]}})
    assert bad.status_code == 400 and "platform" in bad.json()["detail"]
    bad = put(solapur, form, "solapur", TODAY, {}, {"facebook": {"links": [FB[0], FB[0].replace("www.", "m.")]}})
    assert bad.status_code == 400 and "twice" in bad.json()["detail"]
    assert put(solapur, form, "solapur", EARLIER, {}, {"facebook": {"links": [FB[0]]}}).status_code == 200
    # the same post on another day of this office names the day; another office's only says so
    bad = put(solapur, form, "solapur", TODAY, {}, {"facebook": {"links": [FB[0]]}})
    assert bad.status_code == 400 and EARLIER.isoformat() in bad.json()["detail"]
    bad = put(satara, form, "satara", TODAY, {}, {"facebook": {"links": [FB[0] + "&utm_source=wa"]}})
    assert bad.status_code == 400 and "another office" in bad.json()["detail"] and EARLIER.isoformat() not in bad.json()["detail"]
    # a different form may count the same link
    other = new_form(admin_client)
    assert put(satara, other, "satara", TODAY, {}, {"facebook": {"links": [FB[0]]}}).status_code == 200
    # the live check gives the same answers without saving
    r = satara.post(f"/api/forms/{form['id']}/proof-check", json={
        "office": "satara", "period": TODAY.isoformat(), "field": "facebook",
        "text": f"{FB[0]}\n{FB[1]}\n{FB[1]}\nhttps://x.com/a/status/1"})
    assert [x["problem"] for x in r.json()["links"]] == ["used_other", None, "repeated", "wrong_platform"]
    # an either field can't have more links than its number
    bad = put(solapur, form, "solapur", TODAY, {"activities": 1}, {"activities": {"links": FB[2:4]}})
    assert bad.status_code == 400 and "more links" in bad.json()["detail"]
    assert put(solapur, form, "solapur", TODAY, {"activities": 2}, {"activities": {"links": FB[2:4]}}).status_code == 200
    # files on a links field and links on a files field are refused
    assert put(solapur, form, "solapur", TODAY, {}, {"clippings": {"links": [FB[1]]}}).status_code == 400
    assert put(solapur, form, "solapur", TODAY, {}, {"meetings": {"links": [FB[1]]}}).status_code == 400


# --------------------------------------------------------------------------- files + the submit block
def test_files_and_the_submit_block(admin_client, solapur, satara, web):
    form = new_form(admin_client)
    assert put(solapur, form, "solapur", TODAY, {"clippings": 3}).status_code == 200
    r = solapur.post(url(form, "solapur", TODAY, "submit"))
    assert r.status_code == 400 and "proof missing" in r.json()["detail"]
    got = solapur.get(url(form, "solapur", TODAY)).json()
    assert got["status"] == "draft" and got["proof_missing"] == ["clippings"]
    pdf = upload(solapur, form, "solapur", TODAY, "clippings", b"%PDF-1.4 " + b"x" * 2000)
    photo = upload(solapur, form, "solapur", TODAY, "clippings", b"\xff\xd8\xff" + b"y" * 500, "image/jpeg", "a.jpg")
    r = put(solapur, form, "solapur", TODAY, {"clippings": 3}, {"clippings": {"files": [pdf, photo]}}, submit=True)
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["status"] == "submitted" and got["proof_missing"] == []
    assert [(p["kind"], p["name"], p["size"]) for p in got["proofs"]["clippings"]] == [
        ("file", "पुरावा.pdf", 2009), ("file", "a.jpg", 503)]
    # a sent day can't lose its proof
    r = put(solapur, form, "solapur", TODAY, {}, {"clippings": {"files": []}})
    assert r.status_code == 400 and "proof" in r.json()["detail"]
    # the state office entering the same figure for another office is never blocked
    r = admin_client.put(url(form, "satara", TODAY), json={"values": {"clippings": 2}, "submit": True})
    assert r.status_code == 200 and r.json()["status"] == "submitted" and r.json()["proof_missing"] == ["clippings"]


def test_bad_file_keys_are_refused(admin_client, solapur):
    form = new_form(admin_client)
    good = upload(solapur, form, "solapur", TODAY, "clippings", b"%PDF-1.4 abc")
    other_day = {**good, "key": good["key"].replace(TODAY.isoformat(), EARLIER.isoformat())}
    for item in (other_day, {**good, "type": "video/mp4"}, {**good, "size": good["size"] + 1},
                 {**good, "key": good["key"][:-4] + "nope.pdf"}):
        r = put(solapur, form, "solapur", TODAY, {"clippings": 1}, {"clippings": {"files": [item]}})
        assert r.status_code == 400, item
    r = solapur.post(url(form, "solapur", TODAY, "uploads"), json={"field": "clippings", "type": "video/mp4", "size": 10})
    assert r.status_code == 400
    r = solapur.post(url(form, "solapur", TODAY, "uploads"), json={"field": "clippings", "type": "application/pdf",
                                                                   "size": P.MAX_FILE + 1})
    assert r.status_code == 400
    r = solapur.post(url(form, "solapur", TODAY, "uploads"), json={"field": "facebook", "type": "application/pdf", "size": 9})
    assert r.status_code == 400
    r = solapur.put(f"/api/forms/proof-uploads/abc.def", content=b"x", headers={"Content-Type": "application/pdf"})
    assert r.status_code == 403


def test_exempt_period(pform, solapur, entry_open):
    r = put(solapur, pform, "solapur", EARLIER, {"clippings": 3, "facebook": 5}, submit=True)
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["proof_exempt"] is True and got["proof_missing"] == [] and got["values"]["facebook"] == 5


def test_file_access_by_role(admin_client, solapur, pune, zone_pune, zone_nashik):
    form = new_form(admin_client)
    item = upload(solapur, form, "solapur", TODAY, "clippings", b"%PDF-1.4 secret")
    got = put(solapur, form, "solapur", TODAY, {"clippings": 1}, {"clippings": {"files": [item]}}).json()
    pid = got["proofs"]["clippings"][0]["id"]
    path = f"/api/forms/{form['id']}/proofs/{pid}/file"
    r = solapur.get(path)
    assert r.status_code == 200 and r.content == b"%PDF-1.4 secret" and r.headers["content-type"] == "application/pdf"
    assert "inline" in r.headers["content-disposition"]
    assert pune.get(path).status_code == 403
    assert zone_pune.get(path).status_code == 200  # solapur is in the Pune division
    assert zone_nashik.get(path).status_code == 403
    assert admin_client.get(path).status_code == 200
    assert admin_client.get(f"/api/forms/{form['id']}/proofs/999999/file").status_code == 404


# --------------------------------------------------------------------------- review views
def test_responses_and_workbook(admin_client, solapur, satara):
    form = new_form(admin_client)
    pdf = upload(solapur, form, "solapur", TODAY, "clippings", b"%PDF-1.4 a")
    r = put(solapur, form, "solapur", TODAY, {"clippings": 1}, {"clippings": {"files": [pdf]}, "facebook": {"links": FB[:2]}},
            submit=True)
    assert r.status_code == 200, r.text
    admin_client.put(url(form, "satara", TODAY), json={"values": {"clippings": 4}, "submit": True})
    resp = admin_client.get(f"/api/forms/{form['id']}/responses?start={TODAY}&end={TODAY}").json()
    rows = {x["office"]: x for x in resp["rows"]}
    assert len(rows["solapur"]["proofs"]["facebook"]) == 2 and rows["solapur"]["proof_missing"] == []
    assert rows["satara"]["proof_missing"] == ["clippings"] and rows["satara"]["proofs"] == {}

    wb = load_workbook(io.BytesIO(admin_client.get(f"/api/forms/{form['id']}/export?start={TODAY}&end={TODAY}").content))
    assert wb.sheetnames[:3] == ["सूचना", "डेटा एंट्री", "पुरावा"]
    ws = wb["पुरावा"]
    assert [c.value for c in ws[3]] == ["दिनांक", "विभाग", "कार्यालय", "रकाना", "प्रकार", "लिंक"]
    got = [[c.value for c in r][3:] for r in ws.iter_rows(min_row=4)]
    pid = rows["solapur"]["proofs"]["clippings"][0]["id"]
    assert got == [["फेसबुक", "लिंक", FB[0]], ["फेसबुक", "लिंक", FB[1]],
                   ["कात्रणे", "PDF", f"/backend/api/forms/{form['id']}/proofs/{pid}/file"]]


# --------------------------------------------------------------------------- S3 backend (stubbed client)
class FakeS3:
    def __init__(self):
        self.objects = {"proofs/1/pune/2026-11-03/a.pdf": 1234}

    def generate_presigned_url(self, op, Params, ExpiresIn):
        return f"https://bucket.s3.ap-south-1.amazonaws.com/{Params['Key']}?op={op}&exp={ExpiresIn}"

    def head_object(self, Bucket, Key):
        from botocore.exceptions import ClientError
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"ContentLength": self.objects[Key]}


def test_s3_backend_with_a_stubbed_client(monkeypatch, settings):
    import boto3
    fake = FakeS3()
    monkeypatch.setattr(boto3, "client", lambda *a, **kw: fake)
    P._s3_client.cache_clear()
    settings.proof_storage, settings.proof_s3_bucket = "s3", "dgipr-proofs"
    store = P.storage(settings)
    up = store.presign_put("proofs/1/pune/2026-11-03/b.pdf", "application/pdf", 10)
    assert up["url"].startswith("https://bucket.s3.") and "op=put_object" in up["url"]
    assert up["headers"] == {"Content-Type": "application/pdf"}
    assert store.head("proofs/1/pune/2026-11-03/a.pdf") == 1234 and store.head("nope") is None
    assert "op=get_object" in store.open_url("k", "पुरावा.pdf", "application/pdf")
    P._s3_client.cache_clear()


def test_s3_file_opens_by_redirect(monkeypatch, admin_client, solapur, web):
    form = new_form(admin_client)
    item = upload(solapur, form, "solapur", TODAY, "clippings", b"%PDF-1.4 s3")
    pid = put(solapur, form, "solapur", TODAY, {"clippings": 1}, {"clippings": {"files": [item]}}).json()["proofs"]["clippings"][0]["id"]
    import boto3
    monkeypatch.setattr(boto3, "client", lambda *a, **kw: FakeS3())
    P._s3_client.cache_clear()
    monkeypatch.setattr(web.settings, "proof_storage", "s3")
    monkeypatch.setattr(web.settings, "proof_s3_bucket", "dgipr-proofs")
    r = solapur.get(f"/api/forms/{form['id']}/proofs/{pid}/file", follow_redirects=False)
    assert r.status_code == 302 and "op=get_object" in r.headers["location"]
    # the local upload endpoint is off when files go to S3
    assert solapur.put("/api/forms/proof-uploads/x.y", content=b"x").status_code == 404
    P._s3_client.cache_clear()
