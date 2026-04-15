"""
serve.py
Microserviciu FastAPI care expune modelul Random Forest ca endpoint REST.
NestJS îl va apela după ce Gemini termină analiza.
Necesită: pip install fastapi uvicorn joblib scikit-learn
"""

import os
import sys
from contextlib import asynccontextmanager
import pandas as pd

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel, Field
except ImportError:
    print("  Lipsește fastapi. Rulează: pip install fastapi uvicorn")
    sys.exit(1)

try:
    import joblib
    import numpy as np
except ImportError:
    print("  Lipsește joblib/numpy. Rulează: pip install joblib numpy")
    sys.exit(1)

BASE_DIR      = os.path.join(os.path.dirname(__file__), '..')
MODEL_PATH    = os.path.join(BASE_DIR, 'model', 'model.pkl')
ENCODER_PATH  = os.path.join(BASE_DIR, 'model', 'label_encoder.pkl')
FEATURES_PATH = os.path.join(BASE_DIR, 'model', 'feature_names.pkl')

model         = None
label_encoder = None
feature_names = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, label_encoder, feature_names

    print("  Se încarcă modelul ML...")

    for path, name in [
        (MODEL_PATH,    'model.pkl'),
        (ENCODER_PATH,  'label_encoder.pkl'),
        (FEATURES_PATH, 'feature_names.pkl'),
    ]:
        if not os.path.exists(path):
            print(f"  Lipsește fișierul: {path}")
            print("   Rulează mai întâi: python train_model.py")
            sys.exit(1)

    model         = joblib.load(MODEL_PATH)
    label_encoder = joblib.load(ENCODER_PATH)
    feature_names = joblib.load(FEATURES_PATH)

    print("    Model încărcat cu succes!")
    print(f"   Features: {feature_names}")
    print(f"   Clase:    {list(label_encoder.classes_)}")
    print("    Server pornit pe http://localhost:8000")

    yield

    print("Server oprit.")


app = FastAPI(
    title="CV-Analyzer ML Service",
    description="Microserviciu Random Forest pentru predicție recomandare candidat",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    cv_score:         float = Field(..., ge=0, le=100, description="Scor CV din Gemini (0-100)")
    github_score:     float = Field(0,   ge=0, le=100, description="Scor GitHub (0 dacă nu există)")
    final_score:      float = Field(..., ge=0, le=100, description="Scor final compozit (0-100)")
    confidence:       float = Field(65,  ge=0, le=100, description="Scor de încredere (0-100)")
    matched_req:      int   = Field(0,   ge=0,         description="Număr cerințe acoperite")
    missing_req:      int   = Field(0,   ge=0,         description="Număr cerințe lipsă")
    red_flags:        int   = Field(0,   ge=0,         description="Număr semnale de risc")
    evidence_count:   int   = Field(0,   ge=0,         description="Număr dovezi identificate")
    has_github:       int   = Field(0,   ge=0, le=1,   description="1 dacă are GitHub analizat, 0 altfel")
    validated_skills: int   = Field(0,   ge=0,         description="Număr skill-uri validate prin GitHub")


class PredictResponse(BaseModel):
    recommendation:       str
    confidence_ml:        float
    probabilities:        dict[str, float]
    model_version:        str = "random_forest_v1"


@app.get("/health")
def health():
    return {
        "status":  "ok",
        "model":   "random_forest_v1",
        "classes": list(label_encoder.classes_) if label_encoder else [],
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    if model is None or label_encoder is None or feature_names is None:
        raise HTTPException(status_code=503, detail="Modelul nu este încărcat.")

    features_vector = pd.DataFrame([{
    'cv_score':         req.cv_score,
    'github_score':     req.github_score,
    'final_score':      req.final_score,
    'confidence':       req.confidence,
    'matched_req':      req.matched_req,
    'missing_req':      req.missing_req,
    'red_flags':        req.red_flags,
    'evidence_count':   req.evidence_count,
    'has_github':       req.has_github,
    'validated_skills': req.validated_skills,
    }])

    prediction_encoded = model.predict(features_vector)[0]
    probabilities_raw  = model.predict_proba(features_vector)[0]

    recommendation = label_encoder.inverse_transform([prediction_encoded])[0]

    probabilities = {
        cls: round(float(prob), 4)
        for cls, prob in zip(label_encoder.classes_, probabilities_raw)
    }

    confidence_ml = round(float(probabilities_raw[prediction_encoded]) * 100, 1)

    return PredictResponse(
        recommendation=recommendation,
        confidence_ml=confidence_ml,
        probabilities=probabilities,
    )


@app.post("/retrain")
def retrain():
    """
    Endpoint pentru re-antrenare model (apelat după ce se acumulează date noi).
    Rulează train_model.py și reîncarcă modelul.
    """
    global model, label_encoder, feature_names

    import subprocess
    script_path = os.path.join(os.path.dirname(__file__), 'train_model.py')

    result = subprocess.run(
        [sys.executable, script_path],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"Re-antrenare eșuată: {result.stderr}",
        )

    model         = joblib.load(MODEL_PATH)
    label_encoder = joblib.load(ENCODER_PATH)
    feature_names = joblib.load(FEATURES_PATH)

    return {"ok": True, "output": result.stdout}


if __name__ == '__main__':
    try:
        import uvicorn
    except ImportError:
        print("Lipsește uvicorn. Rulează: pip install uvicorn")
        sys.exit(1)

    uvicorn.run(
        "serve:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
    )