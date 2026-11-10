"""Motor de decisión del documento final: cinco componentes, reglas que se imponen y autoridad humana.

Principio rector: «sin evidencia suficiente no se autoriza». La automatización solo frena un pago;
todo pago que sale tiene la confirmación de una persona con autoridad.
"""

import json
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from vericall.config import (ACCEPT_MAX, DIRECTORY_PATH, PROFILE_MAX_AGE_DAYS, RESOLUTION_SLA_SECONDS,
                             REVIEW_MAX, THRESHOLDS_APPROVAL, THRESHOLDS_VERSION)

RULE_VERSION = "risk-v4.0"
BOGOTA = ZoneInfo("America/Bogota")
ROLES = {"analista": "Analista de tesorería", "cfo": "CFO del cliente",
         "directivo": "Otro directivo autorizado", "seguridad": "Seguridad TI del cliente"}
COMPONENTS = {
    "authenticity": "Autenticidad de rostro y voz",
    "profile": "Coincidencia con el perfil enrolado",
    "history": "Anomalía frente al historial",
    "account": "Riesgo de la cuenta beneficiaria",
    "connection": "Riesgo de la conexión",
}
CONTEXT_FLAGS = ("account_foreign", "account_fraud_list", "virtual_camera", "unusual_connection", "new_device")
UNENROLLED = {"id": "no_enrolado", "name": "Persona no enrolada", "title": "No figura en el directorio",
              "is_cfo": False, "enrolled_on": None, "consent": "no_aplica", "registered_phone": None,
              "habitual_max_amount": None, "usual_hours": None}


class InputError(ValueError):
    pass


def load_directory() -> dict:
    return json.loads(DIRECTORY_PATH.read_text())


def profile_status(executive: dict, today: date | None = None) -> dict:
    today = today or datetime.now(BOGOTA).date()
    if not executive.get("enrolled_on"):
        return {"enrolled": False, "expired": False, "consent_active": False, "age_days": None}
    age = (today - date.fromisoformat(executive["enrolled_on"])).days
    return {"enrolled": True, "expired": age > PROFILE_MAX_AGE_DAYS,
            "consent_active": executive.get("consent") == "vigente", "age_days": age}


def find_requester(requester_id: str | None) -> dict:
    if not requester_id or requester_id == UNENROLLED["id"]:
        return dict(UNENROLLED)
    for executive in load_directory()["executives"]:
        if executive["id"] == requester_id:
            return dict(executive)
    raise InputError("El solicitante no existe en el directorio.")


def positive_money(raw: object, label: str) -> Decimal:
    try:
        number = Decimal(str(raw))
    except (InvalidOperation, TypeError):
        raise InputError(f"{label} debe ser un número positivo.") from None
    if not number.is_finite() or number <= 0 or number > Decimal("1000000000000"):
        raise InputError(f"{label} debe ser un número positivo y finito de hasta 10¹².")
    if number.as_tuple().exponent < -2:
        raise InputError(f"{label} admite como máximo dos decimales.")
    return number.quantize(Decimal("0.01"))


def band(score: int) -> str:
    return "aceptar" if score <= ACCEPT_MAX else "revisar" if score <= REVIEW_MAX else "rechazar"


def evaluate(*, amount: object, limit: object, new_beneficiary: bool, detection: dict,
             requester: dict | None = None, context: dict | None = None, safe_mode: bool = False,
             now: datetime | None = None) -> dict:
    amount_value = positive_money(amount, "El monto")
    limit_value = positive_money(limit, "El límite")
    requester = requester or dict(UNENROLLED)
    context = {flag: bool((context or {}).get(flag)) for flag in CONTEXT_FLAGS}
    now = (now or datetime.now(timezone.utc)).astimezone(BOGOTA)
    status = profile_status(requester, now.date())
    reasons, mandatory = [], []

    def add(component: str, points: int, code: str, text: str, forces_review: bool = False):
        reasons.append({"component": component, "code": code, "points": points, "text": text,
                        "forces_review": forces_review})
        if forces_review:
            mandatory.append(code)

    # 1. Autenticidad de rostro y voz. Sin consentimiento vigente no se usa biometría.
    biometrics_allowed = not status["enrolled"] or status["consent_active"]
    sufficient = detection["sufficient_face_evidence"]
    if not biometrics_allowed:
        add("authenticity", 0, "biometrics_not_used",
            "El directivo revocó su consentimiento: no se usa su biometría y el pago va por el canal alterno.", True)
    elif sufficient:
        add("authenticity", round(detection["fake_score"] * 100), "visual_model",
            "Señal de manipulación facial del modelo entrenado.")
        if detection["verdict"] == "inconclusive":
            add("authenticity", 0, "uncertain_model", "La salida del modelo está en la zona de incertidumbre (25–75).", True)
    else:
        add("authenticity", 0, "insufficient_faces",
            "Sin evidencia suficiente: no hay rostros observables durante el tiempo necesario.", True)
    if detection["quality"]["frozen_transition_ratio"] >= 0.8:
        add("authenticity", 10, "frozen_video", "La imagen permanece casi inmóvil: la señal no es continua.", True)
    if detection["quality"]["dark_frame_ratio"] >= 0.5:
        add("authenticity", 10, "dark_video", "La mayoría de cuadros son demasiado oscuros.", True)
    if detection["multiple_faces"]:
        add("authenticity", 0, "multiple_faces", "Aparecen varios rostros; no se sabe cuál es el solicitante.", True)

    # 2. Coincidencia con el perfil enrolado.
    if not status["enrolled"]:
        add("profile", 20, "not_enrolled", "El solicitante no está enrolado: va directo a revisión.", True)
    elif status["expired"]:
        add("profile", 10, "profile_expired",
            f"El perfil biométrico tiene {status['age_days']} días; se renueva al menos cada año.", True)

    # 3. Anomalía frente al historial del directivo.
    if amount_value > limit_value:
        add("history", 25, "over_limit", "Monto superior al límite del cliente: revisión obligatoria.", True)
    if requester.get("habitual_max_amount") and amount_value > Decimal(requester["habitual_max_amount"]):
        add("history", 15, "atypical_amount", "Monto mayor al habitual de este directivo.")
    hours = requester.get("usual_hours")
    if hours and not hours[0] <= now.hour < hours[1]:
        add("history", 10, "atypical_hour", f"Solicitud fuera del horario habitual del directivo ({hours[0]}–{hours[1]} h).")

    # 4. Riesgo de la cuenta beneficiaria.
    if new_beneficiary:
        add("account", 25, "new_beneficiary", "Cuenta beneficiaria nueva: revisión obligatoria.", True)
    if context["account_foreign"]:
        add("account", 10, "foreign_account", "Cuenta beneficiaria extranjera.")
    if context["account_fraud_list"]:
        add("account", 50, "fraud_list", "La cuenta aparece en listas de fraude.", True)

    # 5. Riesgo de la conexión.
    if context["virtual_camera"]:
        add("connection", 30, "virtual_camera", "Cámara virtual detectada.", True)
    if context["unusual_connection"]:
        add("connection", 15, "unusual_connection", "IP, ubicación o VPN inusual para este directivo.")
    if context["new_device"]:
        add("connection", 10, "new_device", "Dispositivo no reconocido.")

    if safe_mode:
        add("governance", 0, "safe_mode", "Modo seguro activo: todo pago pasa a verificación alterna.", True)

    score = min(sum(reason["points"] for reason in reasons), 100)
    score_band = band(score)
    if score_band == "rechazar":
        action = "bloquear_y_escalar"
    elif score_band == "revisar" or mandatory:
        action = "revisar_canal_alterno"
    else:
        action = "autorizar_pendiente_confirmacion"
    # Valla permanente: nunca se autoriza un puntaje mayor a 70.
    if action == "autorizar_pendiente_confirmacion" and score > REVIEW_MAX:
        raise RuntimeError("Valla permanente violada: un puntaje mayor a 70 no puede recomendar autorizar.")

    ranked = sorted((r for r in reasons if r["points"] > 0), key=lambda r: -r["points"])
    top = ranked[:3] or [r for r in reasons if r["forces_review"]][:3]
    if not reasons:
        reasons.append({"component": "none", "code": "no_flags", "points": 0, "forces_review": False,
                        "text": "Sin alertas en los cinco componentes; el analista debe confirmar."})
        top = reasons[:1]
    components = {key: {"label": label, "points": min(sum(r["points"] for r in reasons if r["component"] == key), 100),
                        "measured": key != "authenticity" or (sufficient and biometrics_allowed)}
                  for key, label in COMPONENTS.items()}

    return {
        "rule_version": RULE_VERSION,
        "thresholds": {"version": THRESHOLDS_VERSION, "accept_max": ACCEPT_MAX, "review_max": REVIEW_MAX,
                       "approval": THRESHOLDS_APPROVAL},
        "score": score,
        "band": score_band,
        "action": action,
        "mandatory_review": mandatory,
        "safe_mode": safe_mode,
        "components": components,
        "top_reasons": [r["text"] for r in top],
        "reasons": reasons,
        "inputs": {
            "amount": str(amount_value),
            "limit": str(limit_value),
            "new_beneficiary": new_beneficiary,
            **context,
            "evaluated_at_bogota": now.isoformat(timespec="seconds"),
            "requester": {key: requester.get(key) for key in ("id", "name", "title", "is_cfo", "enrolled_on",
                                                             "consent", "registered_phone")} | {"profile": status},
        },
        "limitations": "La voz no se analiza en este prototipo. La coincidencia con el perfil usa el directorio "
                       "declarado; no hay reconocimiento facial contra la referencia enrolada.",
        "warning": "El puntaje combina la señal visual y reglas de negocio. No es una probabilidad de fraude ni ejecuta un pago.",
    }


def allowed_releasers(entry: dict) -> set[str]:
    action = entry["decision"]["action"]
    if action == "bloquear_y_escalar":
        requester = entry["decision"]["inputs"].get("requester") or {}
        return {"directivo"} if requester.get("is_cfo") else {"cfo"}
    return {"analista", "cfo"}


def resolve(entry: dict, *, outcome: str, role: str, actor: str, alternate_verified: bool,
            channel: str, now: datetime, justification: str = "") -> dict:
    """Decisión humana final. Aplica la matriz de autoridad y las restricciones innegociables."""
    action = entry["decision"]["action"]
    actor, channel = (actor or "").strip()[:80], (channel or "").strip()[:200]
    justification = (justification or "").strip()[:500]
    if outcome not in ("release", "reject"):
        raise InputError("Elige liberar o rechazar el pago.")
    if role not in ROLES:
        raise InputError("Rol no reconocido.")
    if not actor:
        raise InputError("Indica el nombre de quien toma la decisión final.")
    if alternate_verified and not channel:
        raise InputError("Describe el canal alterno: llamada al número registrado del directivo, nunca a uno dado en la llamada.")
    # Confirmar un riesgo bajo no exige texto; cualquier otra resolución sí (desacuerdo, retención o bloqueo).
    needs_justification = not (outcome == "release" and action == "autorizar_pendiente_confirmacion")
    requester = entry["decision"].get("inputs", {}).get("requester") or {}
    if outcome == "release":
        allowed = allowed_releasers(entry)
        if role not in allowed:
            if action == "bloquear_y_escalar":
                raise InputError("Un bloqueo crítico solo lo libera otro directivo autorizado, porque el solicitante es el CFO."
                                 if requester.get("is_cfo") else "Un bloqueo crítico solo lo libera el CFO del cliente.")
            raise InputError("Este pago lo libera el analista de tesorería o el CFO. Los demás roles solo pueden frenarlo.")
        if action != "autorizar_pendiente_confirmacion" and not alternate_verified:
            raise InputError("Nunca se libera un pago retenido o bloqueado sin verificación exitosa por canal alterno."
                             if action == "bloquear_y_escalar" else
                             "Este pago solo se libera después de verificarlo por un canal alterno.")
        if action == "bloquear_y_escalar":
            if actor.casefold() == (entry.get("analyst") or "").strip().casefold():
                raise InputError("Segregación de funciones: quien solicitó la evaluación no puede liberar su propio bloqueo.")
            if requester.get("name") and actor.casefold() == requester["name"].casefold():
                raise InputError("Segregación de funciones: la persona suplantada no puede liberar el pago pedido en su nombre.")
    if needs_justification and len(justification) < 10:
        raise InputError("Escribe una justificación (mínimo 10 caracteres). No se aceptan cambios sin justificación escrita.")
    elapsed = (now - datetime.fromisoformat(entry["timestamp_utc"])).total_seconds()
    agrees = (outcome == "release") == (action == "autorizar_pendiente_confirmacion")
    return {
        "outcome": outcome,
        "status": "liberada" if outcome == "release" else "rechazada",
        "role": role, "role_label": ROLES[role], "actor": actor,
        "alternate_verified": alternate_verified, "alternate_channel": channel or None,
        "justification": justification or None, "justification_required": needs_justification,
        "agrees_with_system": agrees,
        "recommended_action": action,
        "elapsed_seconds": round(elapsed, 1),
        "sla_seconds": RESOLUTION_SLA_SECONDS,
        "within_sla": elapsed <= RESOLUTION_SLA_SECONDS,
        "rule_version": RULE_VERSION,
        "note": "Rol declarado en la demostración; un piloto requiere doble autenticación y permisos por rol.",
    }


SAFE_MODE_ROLE = "riesgo"


def safe_mode_change(*, active: bool, role: str, actor: str, reason: str, current: bool) -> dict:
    actor, reason = (actor or "").strip()[:80], (reason or "").strip()[:500]
    if role != SAFE_MODE_ROLE:
        raise InputError("Solo el área de Riesgo de VeriCall activa o levanta el modo seguro.")
    if not actor:
        raise InputError("Indica el nombre de quien cambia el modo seguro.")
    if len(reason) < 10:
        raise InputError("Explica el motivo (mínimo 10 caracteres): queda en la bitácora.")
    if active == current:
        raise InputError("El modo seguro ya está " + ("activo." if current else "inactivo."))
    return {"active": active, "role": role, "role_label": "Riesgo de VeriCall", "actor": actor, "reason": reason,
            "informed": ["Comité de riesgo", "CFO del cliente"] if active else ["CFO del cliente"]}


def stale_profiles(today: date | None = None) -> list[dict]:
    today = today or datetime.now(BOGOTA).date()
    return [{"id": e["id"], "name": e["name"], **profile_status(e, today)}
            for e in load_directory()["executives"] if profile_status(e, today)["expired"]]
