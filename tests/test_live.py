import io
import json
import sqlite3
from datetime import datetime, timedelta, timezone

import cv2
import numpy as np
import pytest

from vericall.app import create_app
from vericall.audit import AuditStore
from vericall.config import FACE_MODEL, ROOT
from vericall.decision import InputError, resolve, safe_mode_change
from vericall.detector import model_status


class FixedScores:
    def __init__(self, score):
        self.score = score

    def predict(self, crops):
        return [self.score for _ in crops]


class OneFace:
    def find(self, frame):
        return [{"crop": frame[:64, :64], "box": [0.25, 0.2, 0.3, 0.4], "confidence": 0.99}]


def jpeg(seed=0):
    image = np.random.default_rng(seed).integers(0, 255, (240, 320, 3), dtype=np.uint8)
    return cv2.imencode(".jpg", image)[1].tobytes()


@pytest.fixture
def live_app(tmp_path):
    def build(score):
        app = create_app(tmp_path / f"audit-{score}.sqlite3", live_detector=FixedScores(score))
        app.extensions["vericall_live"]._faces = OneFace()
        return app, app.test_client()
    yield build


def start(client, **values):
    data = {"consent": "yes", "source": "camera", "requester_id": "carolina_ruiz"} | values
    return client.post("/api/live/sessions", data=data)


def send(client, session_id, frames):
    result = None
    for seed in range(frames):
        response = client.post(f"/api/live/sessions/{session_id}/frames", data={"frame": (io.BytesIO(jpeg(seed)), "f.jpg")})
        assert response.status_code == 200, response.json
        result = response.json
    return result


def test_live_session_requires_consent_and_valid_source(live_app):
    _, client = live_app(.1)
    assert start(client, consent="no").status_code == 400
    assert start(client, source="satellite").status_code == 400
    assert start(client, source="simulated", sample_id="missing").status_code == 400
    assert start(client).status_code == 201


def test_live_frames_never_store_images_and_raise_alert(live_app):
    _, client = live_app(.9)
    session = start(client).json["session_id"]
    result = send(client, session, 6)
    assert result["recent_window"]["verdict"] == "likely_manipulated" and result["alert"] is True
    assert result["frame"]["faces"][0]["fake_score"] == 0.9
    assert "crop" not in json.dumps(result)
    bad = client.post(f"/api/live/sessions/{session}/frames", data={"frame": (io.BytesIO(b"not an image"), "f.jpg")})
    assert bad.status_code == 400
    assert client.post("/api/live/sessions/unknown/frames", data={"frame": (io.BytesIO(jpeg()), "f.jpg")}).status_code == 404


def test_live_transfer_blocks_deepfake_and_records_call_evidence(live_app):
    _, client = live_app(.9)
    session = start(client).json["session_id"]
    send(client, session, 6)
    response = client.post(f"/api/live/sessions/{session}/transfer", data={"amount": "250000", "limit": "1000000", "analyst": "Ana"})
    assert response.status_code == 201
    entry = response.json
    assert entry["source"] == "live" and entry["decision"]["action"] == "bloquear_y_escalar"
    assert entry["detection"]["live"]["caller_claimed_identity"] == "Carolina Ruiz · Gerente general"
    assert entry["decision"]["inputs"]["requester"]["name"] == "Carolina Ruiz"
    assert len(entry["detection"]["frames"]) == 6 and entry["integrity"]["seq"] == 1
    assert client.get("/api/history").json[0]["source"] == "live"
    client.post(f"/api/live/sessions/{session}/end")
    assert client.post(f"/api/live/sessions/{session}/transfer", data={"amount": "1"}).status_code == 404


def test_live_real_caller_can_be_authorized_but_little_evidence_cannot(live_app):
    _, client = live_app(.05)
    session = start(client).json["session_id"]
    send(client, session, 2)
    early = client.post(f"/api/live/sessions/{session}/transfer", data={"amount": "1000", "limit": "5000"}).json
    assert early["decision"]["action"] == "revisar_canal_alterno"
    send(client, session, 4)
    later = client.post(f"/api/live/sessions/{session}/transfer", data={"amount": "1000", "limit": "5000"}).json
    assert later["decision"]["action"] == "autorizar_pendiente_confirmacion"


def test_recent_window_dominates_when_attack_starts_mid_call(tmp_path):
    app = create_app(tmp_path / "audit.sqlite3", live_detector=FixedScores(.05))
    app.extensions["vericall_live"]._faces = OneFace()
    client = app.test_client()
    session = start(client).json["session_id"]
    send(client, session, 40)
    app.extensions["vericall_live"].detector.score = .95
    send(client, session, 16)
    entry = client.post(f"/api/live/sessions/{session}/transfer", data={"amount": "1000"}).json
    assert entry["detection"]["decision_basis"] == "recent_window"
    assert entry["decision"]["action"] == "bloquear_y_escalar"


def entry(action, analyst="Ana", minutes=3, cfo_requester=False):
    created = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    requester = {"name": "María Gómez", "is_cfo": True} if cfo_requester else {"name": "Carolina Ruiz", "is_cfo": False}
    return {"decision": {"action": action, "inputs": {"requester": requester}}, "analyst": analyst,
            "timestamp_utc": created.isoformat()}


WHY = "Llamé al número registrado y confirmó"


def test_resolution_rules_follow_authority_matrix():
    now = datetime.now(timezone.utc)
    ok = resolve(entry("autorizar_pendiente_confirmacion"), outcome="release", role="analista", actor="Ana",
                 alternate_verified=False, channel="", now=now)
    assert ok["status"] == "liberada" and ok["within_sla"] is True and ok["agrees_with_system"] is True
    with pytest.raises(InputError, match="justificación"):
        resolve(entry("autorizar_pendiente_confirmacion"), outcome="reject", role="analista", actor="Ana",
                alternate_verified=False, channel="", now=now)
    stopped = resolve(entry("autorizar_pendiente_confirmacion"), outcome="reject", role="analista", actor="Ana",
                      alternate_verified=False, channel="", justification="Me pareció raro el tono", now=now)
    assert stopped["agrees_with_system"] is False
    with pytest.raises(InputError, match="canal alterno"):
        resolve(entry("revisar_canal_alterno"), outcome="release", role="analista", actor="Ana",
                alternate_verified=False, channel="", justification=WHY, now=now)
    with pytest.raises(InputError, match="solo pueden frenarlo"):
        resolve(entry("revisar_canal_alterno"), outcome="release", role="seguridad", actor="Luis",
                alternate_verified=True, channel="Número registrado", justification=WHY, now=now)
    for role in ("analista", "seguridad", "directivo"):
        with pytest.raises(InputError, match="CFO"):
            resolve(entry("bloquear_y_escalar"), outcome="release", role=role, actor="Luis",
                    alternate_verified=True, channel="Número registrado", justification=WHY, now=now)
    with pytest.raises(InputError, match="Segregación"):
        resolve(entry("bloquear_y_escalar"), outcome="release", role="cfo", actor="ana",
                alternate_verified=True, channel="Número registrado", justification=WHY, now=now)
    with pytest.raises(InputError, match="suplantada"):
        resolve(entry("bloquear_y_escalar"), outcome="release", role="cfo", actor="Carolina Ruiz",
                alternate_verified=True, channel="Número registrado", justification=WHY, now=now)
    released = resolve(entry("bloquear_y_escalar", minutes=20), outcome="release", role="cfo", actor="María",
                       alternate_verified=True, channel="Número registrado", justification=WHY, now=now)
    assert released["within_sla"] is False
    # Si el solicitante es el CFO, el bloqueo lo libera otro directivo autorizado.
    with pytest.raises(InputError, match="otro directivo"):
        resolve(entry("bloquear_y_escalar", cfo_requester=True), outcome="release", role="cfo", actor="Pedro",
                alternate_verified=True, channel="Número registrado", justification=WHY, now=now)
    assert resolve(entry("bloquear_y_escalar", cfo_requester=True), outcome="release", role="directivo", actor="Pedro",
                   alternate_verified=True, channel="Número registrado", justification=WHY, now=now)["status"] == "liberada"
    rejected = resolve(entry("bloquear_y_escalar"), outcome="reject", role="seguridad", actor="Luis",
                       alternate_verified=False, channel="", justification="Investigación de seguridad abierta", now=now)
    assert rejected["status"] == "rechazada"


def test_resolution_api_is_single_and_chained(live_app):
    _, client = live_app(.9)
    session = start(client).json["session_id"]
    send(client, session, 6)
    decision_id = client.post(f"/api/live/sessions/{session}/transfer", data={"amount": "1000", "analyst": "Ana"}).json["decision_id"]
    url = f"/api/decisions/{decision_id}/resolution"
    assert client.post(url, data={"outcome": "release", "role": "analista", "actor": "Ana"}).status_code == 400
    done = client.post(url, data={"outcome": "release", "role": "cfo", "actor": "María Gómez", "justification": WHY,
                                  "alternate_verified": "yes", "channel": "Llamé al número registrado"})
    assert done.status_code == 201 and done.json["integrity"]["seq"] == 2
    assert client.post(url, data={"outcome": "reject", "role": "analista", "actor": "Ana"}).status_code == 409
    assert client.get(f"/api/decisions/{decision_id}").json["resolution"]["actor"] == "María Gómez"
    assert client.post("/api/decisions/missing/resolution", data={}).status_code == 404
    assert client.get("/api/audit/verify").json == {"valid": True, "records": 2, "first_invalid_seq": None,
                                                     "head": done.json["integrity"]["hash"]}


def test_safe_mode_only_by_risk_and_forces_review(live_app):
    _, client = live_app(.05)
    url = "/api/governance/safe-mode"
    assert client.post(url, data={"active": "yes", "role": "cfo", "actor": "María", "reason": "Detección bajo 95 %"}).status_code == 400
    assert client.post(url, data={"active": "yes", "role": "riesgo", "actor": "Rita", "reason": "corto"}).status_code == 400
    assert client.post(url, data={"active": "yes", "role": "riesgo", "actor": "Rita", "reason": "Detección bajo 95 %"}).status_code == 201
    assert client.get("/api/governance").json["safe_mode"]["active"] is True
    session = start(client).json["session_id"]
    send(client, session, 6)
    entry = client.post(f"/api/live/sessions/{session}/transfer", data={"amount": "1000", "limit": "5000"}).json
    assert entry["decision"]["action"] == "revisar_canal_alterno" and entry["decision"]["safe_mode"] is True
    assert client.post(url, data={"active": "no", "role": "riesgo", "actor": "Rita", "reason": "Causa corregida y probada"}).status_code == 201
    assert client.get("/api/governance").json["safe_mode"]["active"] is False
    assert client.get("/api/audit/verify").json["valid"] is True
    with pytest.raises(InputError, match="ya está"):
        safe_mode_change(active=False, role="riesgo", actor="Rita", reason="Sin cambios reales", current=False)


def test_governance_dashboard_measures_simulated_attacks(live_app):
    _, client = live_app(.9)
    session = start(client, source="simulated", sample_id="fake_01").json["session_id"]
    send(client, session, 6)
    client.post(f"/api/live/sessions/{session}/transfer", data={"amount": "1000"})
    board = client.get("/api/governance").json
    metrics = {m["key"]: m for m in board["metrics"]}
    assert metrics["effectiveness"]["value"] == 100.0 and metrics["effectiveness"]["status"] == "aceptable"
    assert metrics["traceability"]["value"] == 100.0
    assert metrics["fairness"]["status"] == "sin_datos"
    assert board["monitoring"]["pending_queue"] == 1
    assert any("Andrés Pardo" in t["text"] for t in board["triggers"])
    directory = client.get("/api/directory").json
    assert {e["id"] for e in directory["executives"]} >= {"carolina_ruiz", "maria_gomez"}


def test_hash_chain_detects_edited_record(tmp_path):
    path = tmp_path / "audit.sqlite3"
    store = AuditStore(path)
    first = store.record({"decision": {"action": "bloquear_y_escalar"}})
    store.record({"decision": {"action": "autorizar_pendiente_confirmacion"}})
    assert store.verify()["valid"]
    with sqlite3.connect(path) as db:
        payload = json.loads(db.execute("SELECT payload FROM ledger WHERE id = ?", (first["decision_id"],)).fetchone()[0])
        payload["decision"]["action"] = "autorizar_pendiente_confirmacion"
        db.execute("UPDATE ledger SET payload = ? WHERE id = ?", (json.dumps(payload), first["decision_id"]))
    assert store.verify() == {"valid": False, "records": 1, "first_invalid_seq": 1, "head": None}


def test_v2_table_is_migrated_into_chain(tmp_path):
    path = tmp_path / "old.sqlite3"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE decisions (id TEXT PRIMARY KEY, created TEXT NOT NULL, payload TEXT NOT NULL)")
        db.execute("INSERT INTO decisions VALUES ('a', '2026-10-25T00:00:00+00:00', ?)",
                   (json.dumps({"decision_id": "a", "timestamp_utc": "2026-10-25T00:00:00+00:00", "decision": {}}),))
    store = AuditStore(path)
    assert store.get("a")["integrity"]["seq"] == 1 and store.verify()["valid"]


@pytest.mark.model
def test_live_monitor_with_real_model_on_public_frames(tmp_path):
    assert model_status()["available"] and FACE_MODEL.exists()
    app = create_app(tmp_path / "audit.sqlite3")
    client = app.test_client()
    results = {}
    for sample in ("real_04", "fake_01"):
        session = start(client, source="simulated", sample_id=sample).json["session_id"]
        capture = cv2.VideoCapture(str(ROOT / f"sample_data/public/{sample}.mp4"))
        count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        for index in np.linspace(0, count - 1, 12, dtype=int):
            capture.set(cv2.CAP_PROP_POS_FRAMES, int(index))
            ok, frame = capture.read()
            assert ok
            data = cv2.imencode(".jpg", frame)[1].tobytes()
            assert client.post(f"/api/live/sessions/{session}/frames", data={"frame": (io.BytesIO(data), "f.jpg")}).status_code == 200
        capture.release()
        results[sample] = client.post(f"/api/live/sessions/{session}/transfer", data={"amount": "1000"}).json
    assert results["real_04"]["detection"]["fake_score"] < results["fake_01"]["detection"]["fake_score"]
    assert results["real_04"]["decision"]["action"] != "bloquear_y_escalar"


def test_own_video_call_requires_hash_and_records_it(live_app):
    _, client = live_app(.9)
    assert start(client, source="file").status_code == 400
    assert start(client, source="file", video_sha256="xyz").status_code == 400
    digest = "ab" * 32
    session = start(client, source="file", video_sha256=digest.upper()).json["session_id"]
    send(client, session, 6)
    entry = client.post(f"/api/live/sessions/{session}/transfer", data={"amount": "1000"}).json
    assert entry["video_sha256"] == digest
    assert entry["detection"]["live"]["source"] == "file"


def test_deepfake_camera_swaps_in_memory_and_counts_as_simulated_attack(live_app):
    if not FACE_MODEL.exists() or not (ROOT / "sample_data/public/dfd_real_07.mp4").exists():
        pytest.skip("Requiere YuNet y los videos DFD descargados.")
    _, client = live_app(.9)
    assert start(client, source="deepfake_camera").status_code == 400
    presets = client.get("/api/faceswap/presets").json
    assert {p["id"] for p in presets} == {"dfd_real_03", "dfd_real_05", "dfd_real_07"}
    assert client.get(presets[0]["thumbnail"]).mimetype == "image/jpeg"
    assert client.post("/api/faceswap/sources", data={"photo": (io.BytesIO(jpeg()), "p.jpg")}).status_code == 400
    source = client.post("/api/faceswap/sources", data={"preset_id": "dfd_real_07"})
    assert source.status_code == 201
    source_id = source.json["source_id"]
    capture = cv2.VideoCapture(str(ROOT / "sample_data/public/dfd_real_03.mp4"))
    capture.set(cv2.CAP_PROP_POS_FRAMES, 200)
    ok, frame = capture.read()
    capture.release()
    data = cv2.imencode(".jpg", cv2.resize(frame, (960, 540)))[1].tobytes()
    swapped = client.post("/api/faceswap/frame", data={"source_id": source_id, "frame": (io.BytesIO(data), "f.jpg")})
    assert swapped.status_code == 200 and swapped.mimetype == "image/jpeg" and swapped.headers["X-Faces"] == "1"
    assert client.post("/api/faceswap/frame", data={"source_id": "nope", "frame": (io.BytesIO(data), "f.jpg")}).status_code == 404
    session = start(client, source="deepfake_camera", faceswap_source_id=source_id).json["session_id"]
    send(client, session, 6)
    entry = client.post(f"/api/live/sessions/{session}/transfer", data={"amount": "1000"}).json
    assert entry["reference_label"] == "fake"
    assert entry["detection"]["live"]["simulated_deepfake"]["preset_id"] == "dfd_real_07"
    metrics = {m["key"]: m for m in client.get("/api/governance").json["metrics"]}
    assert "1 de 1" in metrics["effectiveness"]["detail"]
