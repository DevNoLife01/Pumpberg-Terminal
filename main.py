"""
main.py
Launch Pumpberg frontend + backend
"""

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.main import app as backend_app


app = FastAPI()

# mount backend API
app.mount("/api", backend_app)

# serve frontend
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")


if __name__ == "__main__":

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )