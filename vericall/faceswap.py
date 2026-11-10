"""Deepfake de demostración sobre la cámara propia: intercambio de rostro en vivo, solo en memoria.

Simula al atacante del documento final, que usa una «cámara virtual» para suplantar a un directivo.
Motor clásico (sin red neuronal generativa): YuNet entrega 5 puntos del rostro de origen y del
rostro en cámara; una transformación de similitud alinea el origen, se iguala el color en LAB y se
funde con una máscara difuminada. Sigue la posición y el giro de la cabeza, pero la boca del rostro
de origen no se mueve. Los rostros de origen permitidos son los actores con consentimiento del
DeepFake Detection Dataset o una foto con autorización declarada. Nada se escribe en disco.
"""

import hashlib
import threading
import time
from uuid import uuid4

import cv2
import numpy as np

from vericall.detector import FaceDetector
from vericall.video import VideoError

ENGINE = "faceswap-clasico-opencv-v1"
MAX_SOURCES = 6
SOURCE_TTL_SECONDS = 1800
MAX_FRAME_SIDE = 960
# Rostros de origen predefinidos: actores con consentimiento del DFD; cuadro elegido con ojos abiertos y boca cerrada.
PRESETS = {"dfd_real_03": 500, "dfd_real_05": 120, "dfd_real_07": 120}


def preset_frame(path, index: int) -> np.ndarray:
    capture = cv2.VideoCapture(str(path))
    try:
        capture.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = capture.read()
    finally:
        capture.release()
    if not ok:
        raise VideoError("No se pudo leer el cuadro del actor de referencia.")
    scale = min(1.0, MAX_FRAME_SIDE / max(frame.shape[:2]))
    return cv2.resize(frame, None, fx=scale, fy=scale)


class SourceNotFound(KeyError):
    pass


def decode(data: bytes, label: str) -> np.ndarray:
    if not data or len(data) > 8 * 1024 * 1024:
        raise VideoError(f"{label}: archivo vacío o mayor de 8 MB.")
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or min(image.shape[:2]) < 64:
        raise VideoError(f"{label}: no es una imagen válida de al menos 64 px.")
    scale = min(1.0, MAX_FRAME_SIDE / max(image.shape[:2]))
    return cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image


def face_mask(shape, points: np.ndarray, box: np.ndarray) -> np.ndarray:
    """Óvalo del rostro (frente a mentón) a partir de los ojos y la boca."""
    eyes, mouth = points[:2].mean(axis=0), points[3:5].mean(axis=0)
    eye_span = np.linalg.norm(points[0] - points[1])
    center = (eyes + mouth) / 2 + (mouth - eyes) * 0.3
    axes = (eye_span * 1.05, np.linalg.norm(mouth - eyes) * 1.45)
    angle = np.degrees(np.arctan2(*(points[1] - points[0])[::-1]))
    mask = np.zeros(shape[:2], np.float32)
    cv2.ellipse(mask, (int(center[0]), int(center[1])), (int(axes[0]), int(axes[1])), angle, 0, 360, 1.0, -1)
    blur = max(3, int(eye_span * 0.35) | 1)
    return cv2.GaussianBlur(mask, (blur, blur), 0)


def match_color(source: np.ndarray, target: np.ndarray, mask: np.ndarray) -> np.ndarray:
    region = mask > 0.5
    if region.sum() < 50:
        return source
    src, tgt = (cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32) for img in (source, target))
    for channel in range(3):
        s, t = src[..., channel][region], tgt[..., channel][region]
        src[..., channel] = (src[..., channel] - s.mean()) * (t.std() / (s.std() + 1e-6)) + t.mean()
    return cv2.cvtColor(np.clip(src, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


class FaceSwapper:
    def __init__(self, faces: FaceDetector | None = None):
        self._faces = faces
        self._lock = threading.Lock()
        self.sources: dict[str, dict] = {}

    def _detector(self) -> FaceDetector:
        if self._faces is None:
            self._faces = FaceDetector()
        return self._faces

    def _purge(self):
        now = time.monotonic()
        self.sources = {k: v for k, v in self.sources.items() if now - v["used"] < SOURCE_TTL_SECONDS}

    def add_source(self, image: np.ndarray, origin: dict) -> dict:
        with self._lock:
            found = self._detector().landmarks(image)
            if not found:
                raise VideoError("No se encontró un rostro en la imagen de origen. Usa una foto frontal y bien iluminada.")
            face = found[0]
            self._purge()
            if len(self.sources) >= MAX_SOURCES:
                oldest = min(self.sources, key=lambda key: self.sources[key]["used"])
                self.sources.pop(oldest)
            source_id = str(uuid4())
            self.sources[source_id] = {"image": image, "points": face["points"].astype(np.float32),
                                       "mask": face_mask(image.shape, face["points"], face["box"]),
                                       "origin": origin, "used": time.monotonic()}
            return {"source_id": source_id, "engine": ENGINE, **origin}

    def get(self, source_id: str) -> dict:
        source = self.sources.get(source_id or "")
        if source is None:
            raise SourceNotFound("El rostro de origen expiró o no existe. Vuelve a elegirlo.")
        source["used"] = time.monotonic()
        return source

    def origin(self, source_id: str) -> dict:
        return self.get(source_id)["origin"]

    def swap(self, source_id: str, frame: np.ndarray) -> tuple[np.ndarray, int]:
        source = self.get(source_id)
        with self._lock:
            targets = self._detector().landmarks(frame)
        if not targets:
            return frame, 0
        target = targets[0]
        matrix, _ = cv2.estimateAffinePartial2D(source["points"], target["points"].astype(np.float32), method=cv2.LMEDS)
        if matrix is None:
            return frame, 0
        size = (frame.shape[1], frame.shape[0])
        warped = cv2.warpAffine(source["image"], matrix, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        mask = cv2.warpAffine(source["mask"], matrix, size)
        # La máscara se limita también al óvalo del rostro en cámara, para no salirse de la cabeza.
        mask = np.minimum(mask, face_mask(frame.shape, target["points"], target["box"]) * 1.2).clip(0, 1)
        warped = match_color(warped, frame, mask)
        alpha = mask[..., None]
        return (warped * alpha + frame * (1 - alpha)).astype(np.uint8), len(targets)


def image_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
