"""Prueba de interfaz con navegador real; usa una bitácora temporal aislada."""

import argparse
import json
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server
from vericall.app import create_app


def answer_call(page):
    page.locator('#live-consent').check()
    page.locator('#live-start').click()
    page.wait_for_selector('#call-room:not([hidden])')
    if page.locator('#incoming').is_visible():
        page.locator('#incoming-accept').click()
    page.wait_for_selector('#live-end:not([hidden])')


def request_payment(page):
    page.locator('#request-payment').click()
    page.wait_for_selector('#payment-dialog[open]')
    page.locator('#transfer-form [type=submit]').click()
    page.wait_for_selector('#dialog-decision .verdict')
    return page.locator('#dialog-decision')


def end_call(page):
    page.locator('#live-end').click()
    page.wait_for_selector('#call-stage .ended')
    page.locator('#call-stage .ended .btn.primary').click()
    page.wait_for_selector('#call-setup:not([hidden])')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chrome", default=None, help="Ruta opcional del ejecutable de Chrome.")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="vericall-browser-") as directory:
        app = create_app(Path(directory) / "audit.sqlite3")
        server = make_server("127.0.0.1", 0, app, threaded=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as playwright:
                # Cámara falsa de Chrome: permite probar la captura sin hardware ni diálogo de permisos.
                browser = playwright.chromium.launch(headless=True, executable_path=args.chrome, args=[
                    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
                page = browser.new_page(viewport={"width": 1440, "height": 1000})
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{server.server_port}")
                page.wait_for_selector('.scenario')
                assert page.locator('.scenario').count() == 7

                # Escenario guiado «Ataque»: alerta, bloqueo, autoridad del CFO y justificación obligatoria.
                page.locator('[data-scenario="ataque"]').click()
                assert 'Ataque' in page.locator('#setup-choice').inner_text()
                answer_call(page)
                page.wait_for_function("document.querySelector('#live-status').textContent === 'Posible deepfake'", timeout=60000)
                assert page.locator('#live-alert').is_visible()
                page.screenshot(path='/tmp/vericall_live_alert.png')
                dialog = request_payment(page)
                assert 'Bloquear' in dialog.locator('h3').first.inner_text()
                assert dialog.locator('.reasons li').count() >= 1
                dialog.locator('summary').click()
                assert dialog.locator('.component').count() == 5
                dialog.locator('[name="role"]').select_option('analista')
                dialog.locator('[name="actor"]').fill('Ana Tesorería')
                dialog.locator('[data-outcome="release"]').click()
                dialog.locator('.form-error:not([hidden])').wait_for()
                assert 'CFO' in dialog.locator('.form-error').inner_text()
                dialog.locator('[name="role"]').select_option('seguridad')
                dialog.locator('[name="actor"]').fill('Luis Seguridad')
                dialog.locator('[data-outcome="reject"]').click()
                dialog.locator('.form-error:not([hidden])').wait_for()
                assert 'justificación' in dialog.locator('.form-error').inner_text()
                dialog.locator('[name="justification"]').fill('La gerente confirmó por su número registrado que no pidió el pago')
                dialog.locator('[data-outcome="reject"]').click()
                dialog.locator('.done.rejected').wait_for()
                page.screenshot(path='/tmp/vericall_decision.png')
                page.locator('#payment-dialog [data-close]').first.click()
                assert 'Frenado' in page.locator('#call-requests').inner_text()
                end_call(page)

                # Video propio como llamada entrante: se reproduce en el navegador y solo viajan cuadros.
                page.locator('[data-setup-tab="manual"]').click()
                page.locator('[data-source="file"]').click()
                page.locator('#live-file').set_input_files({'name': 'mi_llamada.mp4', 'mimeType': 'video/mp4',
                                                            'buffer': (ROOT / 'sample_data/public/fake_01.mp4').read_bytes()})
                page.wait_for_function("document.querySelector('#live-file-name').textContent.includes('SHA-256')")
                answer_call(page)
                page.wait_for_function("Number(document.querySelector('#live-frames').textContent) >= 4", timeout=60000)
                assert 'mi_llamada.mp4' in page.locator('#call-events').text_content()
                end_call(page)

                # Cámara: la imagen sintética de Chrome no tiene rostro y no debe producir autorización.
                page.locator('[data-source="camera"]').click()
                answer_call(page)
                page.wait_for_function("Number(document.querySelector('#live-frames').textContent) >= 3", timeout=30000)
                dialog = request_payment(page)
                assert 'otro canal' in dialog.locator('h3').first.inner_text()
                page.locator('#payment-dialog [data-close]').first.click()
                end_call(page)

                # Cámara con deepfake: el rostro de origen se prepara y la llamada queda marcada como simulada.
                page.locator('[data-source="deepfake_camera"]').click()
                page.locator('#swap-presets [data-preset="dfd_real_07"]').click()
                page.wait_for_function("document.querySelector('#swap-status').textContent.includes('Listo')")
                answer_call(page)
                assert page.locator('#swap-pill').is_visible()
                page.wait_for_function("Number(document.querySelector('#live-frames').textContent) >= 3", timeout=30000)
                end_call(page)

                # Grabación: inferencia real, exportación, caso fallado visible, carga propia y error.
                page.locator('[data-nav="grabacion"]').click()
                page.wait_for_selector('#view-grabacion:not([hidden])')
                assert page.locator('#sample-list .sample').count() == 16
                page.locator('#sample-list [data-sample="fake_01"]').click()
                page.wait_for_function("document.querySelector('#preview').readyState >= 2")
                page.locator('#analysis-form [name="consent"]').check()
                page.locator('#analyze-button').click()
                page.wait_for_selector('#result-panel:not([hidden])', timeout=120000)
                assert 'deepfake' in page.locator('#verdict-title').inner_text()
                assert page.locator('#recording-decision .resolve').is_visible()
                page.locator('#recording-decision summary').click()
                with page.expect_download() as download_info:
                    page.locator('#recording-decision .meta a').click()
                downloaded = Path(directory) / 'report.json'
                download_info.value.save_as(downloaded)
                report = json.loads(downloaded.read_text())
                assert report['detection']['predicted_label'] == 'fake' and report['detection']['model']['executed'] is True
                page.screenshot(path='/tmp/vericall_recording.png', full_page=True)

                page.locator('#recording-filter [data-filter="fake"]').click()
                page.locator('#sample-list [data-sample="fake_04"]').click()
                page.locator('#analyze-button').click()
                page.wait_for_selector('#result-panel:not([hidden])', timeout=60000)
                assert 'No coincide' in page.locator('#reference-comparison').inner_text()

                page.locator('#upload-tab').click()
                page.locator('#video-file').set_input_files({'name': 'original_real.mp4', 'mimeType': 'video/mp4',
                                                            'buffer': (ROOT / 'sample_data/public/fake_01.mp4').read_bytes()})
                page.locator('#analyze-button').click()
                page.wait_for_selector('#result-panel:not([hidden])', timeout=60000)
                assert not page.locator('#reference-comparison').is_visible()
                page.locator('#video-file').set_input_files({'name': 'invalid.mp4', 'mimeType': 'video/mp4', 'buffer': b'text, not video'})
                page.locator('#analyze-button').click()
                page.wait_for_selector('#global-error:not([hidden])', timeout=30000)
                assert 'video válido' in page.locator('#global-error').inner_text()

                # Gobierno: indicadores, modo seguro solo por Riesgo VeriCall.
                page.locator('[data-nav="gobierno"]').click()
                page.wait_for_selector('#kpi-grid .kpi')
                assert page.locator('#kpi-grid .kpi').count() == 5
                page.locator('#safe-mode-form [name="actor"]').fill('Rita Riesgo')
                page.locator('#safe-mode-form [name="reason"]').fill('Prueba de disparador en la demostración')
                page.locator('#safe-mode-button').click()
                page.wait_for_selector('#safe-mode-chip:not([hidden])')
                page.screenshot(path='/tmp/vericall_governance.png', full_page=True)
                page.locator('#safe-mode-form [name="reason"]').fill('Causa revisada y corregida en la demostración')
                page.locator('#safe-mode-button').click()
                page.wait_for_selector('#safe-mode-chip', state='hidden')

                # Bitácora: cada fila abre su decisión; la cadena sigue íntegra.
                page.locator('[data-nav="bitacora"]').click()
                page.wait_for_selector('#history-body tr[data-id]')
                assert page.locator('#history-body tr[data-id]').count() == 5
                page.wait_for_function("document.querySelector('#integrity-chip').textContent.includes('íntegra')")
                page.locator('#history-body tr[data-id]').first.click()
                page.wait_for_selector('#detail-dialog[open] .verdict')
                page.locator('#detail-dialog [data-close]').click()

                page.set_viewport_size({'width': 390, 'height': 844})
                for view in ('llamada', 'gobierno', 'bitacora'):
                    page.locator(f'[data-nav="{view}"]').click()
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), view
                page.screenshot(path='/tmp/vericall_mobile.png', full_page=True)
                assert not errors, errors
                browser.close()
                print('PASS: escenario guiado (alerta, bloqueo, autoridad del CFO, justificación), video propio, cámara sin rostro, '
                      'cámara con deepfake, inferencia y JSON, caso fallado, carga propia y error, gobierno y modo seguro, '
                      'bitácora con detalle, vista móvil.', flush=True)
        finally:
            server.shutdown()
            thread.join(timeout=5)
            app.extensions['vericall_jobs'].executor.shutdown(wait=True)


if __name__ == '__main__':
    main()
