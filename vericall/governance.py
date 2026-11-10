"""Tablero de gobierno: las cinco métricas del documento final, disparadores y modo seguro.

Las métricas se calculan sobre la bitácora local. Los «ataques simulados» son las llamadas y
grabaciones hechas con muestras públicas cuya etiqueta de referencia se conoce; la etiqueta nunca
entra al modelo, solo se usa aquí para medir. Con pocos casos, los valores ilustran el mecanismo
y no constituyen una validación estadística.
"""

from statistics import median

from vericall.config import MODEL_REVISION, RESOLUTION_SLA_SECONDS, THRESHOLDS_APPROVAL, THRESHOLDS_VERSION
from vericall.decision import RULE_VERSION, stale_profiles

AUTHORIZE = "autorizar_pendiente_confirmacion"


def _status(value, ok, alert, higher_is_better=True):
    if value is None:
        return "sin_datos"
    if higher_is_better:
        return "aceptable" if value >= ok else "alerta" if value >= alert else "critico"
    return "aceptable" if value <= ok else "alerta" if value <= alert else "critico"


def record_complete(entry: dict) -> bool:
    decision, detection = entry.get("decision") or {}, entry.get("detection") or {}
    complete = bool(entry.get("decision_id") and entry.get("timestamp_utc") and decision.get("rule_version")
                    and decision.get("reasons") and decision.get("inputs") and decision.get("action")
                    and (detection.get("model") or {}).get("revision"))
    resolution = entry.get("resolution")
    if resolution:
        complete &= bool(resolution.get("actor") and resolution.get("role"))
        if resolution.get("justification_required"):
            complete &= bool(resolution.get("justification"))
    return complete


def safe_mode_state(store) -> dict:
    events = store.events("safe_mode", limit=1)
    if not events:
        return {"active": False, "since": None, "actor": None, "reason": None}
    last = events[0]
    return {"active": last["active"], "since": last["timestamp_utc"], "actor": last["actor"], "reason": last["reason"]}


def dashboard(store, samples: dict) -> dict:
    entries = store.recent(limit=None)

    def reference(entry):
        if entry.get("reference_label"):
            return entry["reference_label"]
        sample = samples.get(entry.get("sample_id") or "")
        return sample["reference_label"] if sample else None

    attacks = [e for e in entries if reference(e) == "fake"]
    legit = [e for e in entries if reference(e) == "real"]
    stopped = [e for e in attacks if e["decision"]["action"] != AUTHORIZE]
    fraud_released = [e for e in attacks if (e.get("resolution") or {}).get("outcome") == "release"]
    blocked_legit = [e for e in legit if e["decision"]["action"] == "bloquear_y_escalar"]
    retained_legit = [e for e in legit if e["decision"]["action"] != AUTHORIZE]
    held_released = [e["resolution"]["elapsed_seconds"] for e in entries
                     if e["decision"]["action"] != AUTHORIZE and (e.get("resolution") or {}).get("outcome") == "release"]
    complete = [e for e in entries if record_complete(e)]
    resolved = [e for e in entries if e.get("resolution")]
    disagreements = [e for e in resolved if e["resolution"].get("agrees_with_system") is False]
    pending = [e for e in entries if not e.get("resolution")]

    pct = lambda part, whole: round(100 * len(part) / len(whole), 1) if whole else None
    detection_rate = pct(stopped, attacks)
    detection_status = _status(detection_rate, 98, 95)
    if fraud_released:
        detection_status = "critico"
    friction = pct(blocked_legit, legit)
    worst_minutes = round(max(held_released) / 60, 1) if held_released else None
    traceability = pct(complete, entries)

    metrics = [
        {"key": "effectiveness", "criterion": "Efectividad contra el fraude", "metric": "% de deepfakes detenidos antes del pago",
         "value": detection_rate, "unit": "%", "status": detection_status, "target": "≥ 98 %",
         "bands": "Aceptable ≥ 98 · Alerta 95–98 · Crítico < 95 o un fraude pasa",
         "detail": f"{len(stopped)} de {len(attacks)} ataques simulados no recibieron «autorizar»"
                   + (f"; {len(fraud_released)} liberado(s) por una persona" if fraud_released else "") + "."},
        {"key": "friction", "criterion": "Fricción operativa", "metric": "% de pagos legítimos bloqueados",
         "value": friction, "unit": "%", "status": _status(friction, 2, 5, higher_is_better=False), "target": "≤ 2 %",
         "bands": "Aceptable ≤ 2 · Alerta 2–5 · Crítico > 5",
         "detail": f"{len(blocked_legit)} de {len(legit)} llamadas legítimas simuladas bloqueadas; "
                   f"{len(retained_legit)} retenidas para verificación alterna."},
        {"key": "timeliness", "criterion": "Oportunidad", "metric": "Tiempo para liberar un pago retenido (peor caso)",
         "value": worst_minutes, "unit": "min", "status": _status(worst_minutes, RESOLUTION_SLA_SECONDS / 60, 30, False),
         "target": "≤ 15 min", "bands": "Aceptable ≤ 15 · Alerta 15–30 · Crítico > 30",
         "detail": f"{len(held_released)} pagos retenidos liberados"
                   + (f"; mediana {round(median(held_released) / 60, 1)} min." if held_released else ".")},
        {"key": "traceability", "criterion": "Explicabilidad y trazabilidad", "metric": "% de decisiones con registro completo",
         "value": traceability, "unit": "%", "status": _status(traceability, 100, 98), "target": "100 %",
         "bands": "Aceptable 100 · Alerta 98–99,9 · Crítico < 98",
         "detail": f"{len(complete)} de {len(entries)} registros con datos, versión, razones y, si aplica, justificación."},
        {"key": "fairness", "criterion": "Equidad", "metric": "Brecha de falsos positivos entre grupos",
         "value": None, "unit": "puntos", "status": "sin_datos", "target": "≤ 1 punto",
         "bands": "Aceptable ≤ 1 · Alerta 1–3 · Crítico > 3",
         "detail": "No medible aquí: requiere pruebas con perfiles diversos (piel, acento, género y combinaciones). "
                   "El prototipo no registra atributos de grupo."},
    ]

    triggers = [{"source": m["criterion"], "text": f"{m['metric']}: nivel crítico ({m['value']} {m['unit']}).",
                 "action": "Activar el modo seguro y escalar al comité de riesgo y al CFO del cliente."}
                for m in metrics if m["status"] == "critico"]
    triggers += [{"source": "Efectividad contra el fraude", "text": f"Fraude simulado liberado: {e['decision_id'][:8]}.",
                  "action": "Reconstruir la decisión por su ID y revisar pagos recientes."} for e in fraud_released]
    triggers += [{"source": "Perfil biométrico", "text": f"Perfil vencido de {p['name']} ({p['age_days']} días).",
                  "action": "Re-enrolar presencialmente; mientras tanto sus pagos van a revisión."} for p in stale_profiles()]
    triggers += [{"source": "Monitoreo", "text": f"Alerta en {m['criterion'].lower()} ({m['value']} {m['unit']}).",
                  "action": "Analítica revisa la causa en 24 horas."} for m in metrics if m["status"] == "alerta"]

    return {
        "safe_mode": safe_mode_state(store),
        "metrics": metrics,
        "triggers": triggers,
        "monitoring": {"decisions": len(entries), "pending_queue": len(pending),
                       "disagreement_rate": pct(disagreements, resolved), "resolved": len(resolved),
                       "simulated_attacks": len(attacks), "simulated_legitimate": len(legit)},
        "versions": {"rules": RULE_VERSION, "thresholds": THRESHOLDS_VERSION, "model_revision": MODEL_REVISION,
                     "approval": THRESHOLDS_APPROVAL},
        "note": "Valores calculados sobre la bitácora de esta demostración. Con pocos casos ilustran el mecanismo; "
                "no validan las metas del documento final.",
    }
