"""
train_model.py
Combină datele sintetice cu cele reale și antrenează un model Random Forest.
Salvează modelul în ml/model/model.pkl
Necesită: pip install scikit-learn pandas joblib
"""

import os
import sys

try:
    import pandas as pd
except ImportError:
    print("Lipsește pandas. Rulează: pip install pandas")
    sys.exit(1)

try:
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split, cross_val_score
    from sklearn.metrics import classification_report, confusion_matrix
    from sklearn.preprocessing import LabelEncoder
except ImportError:
    print("Lipsește scikit-learn. Rulează: pip install scikit-learn")
    sys.exit(1)

try:
    import joblib
except ImportError:
    print("Lipsește joblib. Rulează: pip install joblib")
    sys.exit(1)

# ── Căi fișiere ───────────────────────────────────────────────────────────
BASE_DIR       = os.path.join(os.path.dirname(__file__), '..')
SYNTHETIC_PATH = os.path.join(BASE_DIR, 'data', 'synthetic_data.csv')
REAL_PATH      = os.path.join(BASE_DIR, 'data', 'real_data.csv')
MODEL_DIR      = os.path.join(BASE_DIR, 'model')
MODEL_PATH     = os.path.join(MODEL_DIR, 'model.pkl')
ENCODER_PATH   = os.path.join(MODEL_DIR, 'label_encoder.pkl')
FEATURES_PATH  = os.path.join(MODEL_DIR, 'feature_names.pkl')

FEATURE_COLS = [
    'cv_score', 'github_score', 'final_score', 'confidence',
    'matched_req', 'missing_req', 'red_flags', 'evidence_count',
    'has_github', 'validated_skills',
]
LABEL_COL = 'recommendation'


def load_data():
    """Încarcă și combină datele sintetice cu cele reale."""
    if not os.path.exists(SYNTHETIC_PATH):
        print(f"Lipsește: {SYNTHETIC_PATH}")
        print("   Rulează mai întâi: python generate_data.py")
        sys.exit(1)

    df_synthetic = pd.read_csv(SYNTHETIC_PATH)
    print(f"Date sintetice: {len(df_synthetic)} exemple")

    if os.path.exists(REAL_PATH):
        df_real = pd.read_csv(REAL_PATH)
        print(f"Date reale:     {len(df_real)} exemple")

        # Datele reale au greutate mai mare — le duplicăm de 10 ori
        df_real_weighted = pd.concat([df_real] * 10, ignore_index=True)
        df = pd.concat([df_synthetic, df_real_weighted], ignore_index=True)
        print(f"Total după combinare (cu weight date reale x10): {len(df)} exemple")
    else:
        print("real_data.csv nu există, folosesc doar date sintetice")
        df = df_synthetic

    return df


def main():
    print("=" * 55)
    print("  CV-Analyzer ML — Antrenare model Random Forest")
    print("=" * 55)

    # 1. Încarcă date
    df = load_data()

    # 2. Verifică coloane
    missing_cols = [c for c in FEATURE_COLS + [LABEL_COL] if c not in df.columns]
    if missing_cols:
        print(f"Coloane lipsă în date: {missing_cols}")
        sys.exit(1)

    # 3. Pregătește X și y
    X = df[FEATURE_COLS].fillna(0)
    y_raw = df[LABEL_COL].str.upper().str.strip()

    # Encode label: INVITA=0, RESPINGE=1, REVIZUIRE=2
    le = LabelEncoder()
    y = le.fit_transform(y_raw)

    print(f"\nDistribuție clase:")
    for cls, count in zip(le.classes_, pd.Series(y).value_counts().sort_index()):
        print(f"   {cls}: {count}")

    # 4. Split train/test
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"\nTrain: {len(X_train)} | Test: {len(X_test)}")

    # 5. Antrenează modelul
    print("\nAntrenare Random Forest...")
    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=10,
        min_samples_split=4,
        min_samples_leaf=2,
        class_weight='balanced',
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    # 6. Evaluare
    y_pred = model.predict(X_test)
    accuracy = (y_pred == y_test).mean()

    print(f"\nAcuratețe pe test set: {accuracy * 100:.1f}%")
    print("\nRaport detaliat:")
    print(classification_report(y_test, y_pred, target_names=le.classes_))

    # 7. Cross-validation
    cv_scores = cross_val_score(model, X, y, cv=5, scoring='accuracy')
    print(f"Cross-validation (5-fold): {cv_scores.mean()*100:.1f}% ± {cv_scores.std()*100:.1f}%")

    # 8. Feature importance
    print("\nImportanța feature-urilor:")
    importances = sorted(
        zip(FEATURE_COLS, model.feature_importances_),
        key=lambda x: x[1],
        reverse=True,
    )
    for feat, imp in importances:
        bar = "█" * int(imp * 40)
        print(f"   {feat:<20} {imp:.3f} {bar}")

    # 9. Salvează modelul
    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    joblib.dump(le, ENCODER_PATH)
    joblib.dump(FEATURE_COLS, FEATURES_PATH)

    print(f"\nModel salvat în:   {os.path.abspath(MODEL_PATH)}")
    print(f"Encoder salvat în: {os.path.abspath(ENCODER_PATH)}")
    print("\nAntrenare completă! Urmează: python serve.py")


if __name__ == '__main__':
    main()