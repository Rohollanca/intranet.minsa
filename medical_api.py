import base64
import os
import tempfile
from pathlib import Path

import requests
from docx2pdf import convert
from flask import Flask, jsonify, request


BOT_BRIDGE_URL = os.getenv("MEDICAL_BOT_BRIDGE_URL", "http://127.0.0.1:5000").rstrip("/")
ALLOWED_COMMANDS = tuple(
    cmd.strip().lower()
    for cmd in os.getenv("MEDICAL_ALLOWED_COMMANDS", "/dni").split(",")
    if cmd.strip()
)

app = Flask(__name__)


def convert_with_word(input_path, output_path):
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    word = None
    document = None
    try:
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0
        document = word.Documents.Open(
            str(input_path),
            ReadOnly=True,
            AddToRecentFiles=False,
            ConfirmConversions=False,
        )
        document.ExportAsFixedFormat(str(output_path), 17)
    finally:
        if document is not None:
            document.Close(False)
        if word is not None:
            word.Quit()
        pythoncom.CoUninitialize()


def _json_proxy(method, path, **kwargs):
    try:
        response = requests.request(method, f"{BOT_BRIDGE_URL}{path}", timeout=65, **kwargs)
    except requests.RequestException as exc:
        return jsonify({
            "success": False,
            "error": "No se pudo conectar con el puente del bot.",
            "detail": str(exc),
        }), 502

    content_type = response.headers.get("content-type", "")
    if "application/json" not in content_type.lower():
        return jsonify({
            "success": False,
            "error": "El puente del bot respondio en un formato no valido.",
        }), 502

    return response.text, response.status_code, {"Content-Type": content_type}


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "service": "sistema-medico-api",
        "bot_bridge_url": BOT_BRIDGE_URL,
        "allowed_commands": ALLOWED_COMMANDS,
    })


@app.post("/from-whatsapp")
def from_whatsapp():
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text") or "").strip()
    command = text.split(maxsplit=1)[0].lower()

    if not command or command not in ALLOWED_COMMANDS:
        return jsonify({
            "success": False,
            "error": "Comando no permitido para el sistema medico.",
        }), 403

    payload["channel"] = "web"
    payload["sender_jid"] = payload.get("sender_jid") or "sistema_medico"
    return _json_proxy("POST", "/from-whatsapp", json=payload)


@app.get("/last-result")
def last_result():
    internal_id = str(request.args.get("internal_id") or "").strip()
    if not internal_id:
        return jsonify({"error": "internal_id requerido"}), 400
    return _json_proxy("GET", "/last-result", params={"internal_id": internal_id})


@app.post("/convert-docx-to-pdf")
def convert_docx_to_pdf():
    uploaded = request.files.get("file")
    if not uploaded:
        return jsonify({"status": "error", "error": "Archivo DOCX requerido."}), 400

    with tempfile.TemporaryDirectory(prefix="sistema_medico_pdf_") as tmp:
        tmp_path = Path(tmp)
        input_path = tmp_path / "document.docx"
        output_path = tmp_path / "document.pdf"
        uploaded.save(input_path)

        try:
            convert_with_word(input_path, output_path)
        except Exception as word_exc:
            try:
                convert(str(input_path), str(output_path))
            except Exception as docx2pdf_exc:
                return jsonify({
                    "status": "error",
                    "error": "No se pudo convertir el DOCX a PDF.",
                    "detail": f"Word COM: {word_exc}; docx2pdf: {docx2pdf_exc}",
                }), 500

        if not output_path.exists():
            return jsonify({
                "status": "error",
                "error": "La conversion termino sin generar PDF.",
            }), 500

        pdf_base64 = base64.b64encode(output_path.read_bytes()).decode("ascii")
        return jsonify({"status": "success", "pdf_base64": pdf_base64})


if __name__ == "__main__":
    port = int(os.getenv("MEDICAL_API_PORT", "5055"))
    app.run(host="127.0.0.1", port=port, debug=False)
