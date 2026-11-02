@echo off
cd /d "%~dp0"
".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --reload-dir app --reload-exclude "__pycache__" --reload-exclude "*.pyc" --host 127.0.0.1 --port 8000
