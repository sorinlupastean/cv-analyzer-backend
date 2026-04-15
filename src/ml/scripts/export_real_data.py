"""
export_real_data.py
Exportă CV-urile analizate din PostgreSQL în ml/data/real_data.csv
Necesită: pip install psycopg2-binary python-dotenv
"""

import csv
import json
import os
import sys

try:
    import psycopg2
except ImportError:
    print("Lipsește psycopg2. Rulează: pip install psycopg2-binary")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("Lipsește python-dotenv. Rulează: pip install python-dotenv")
    sys.exit(1)



OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'real_data.csv')

DATABASE_HOST     = os.getenv('DATABASE_HOST', 'localhost')
DATABASE_PORT     = os.getenv('DATABASE_PORT', '5432')
DATABASE_NAME     = os.getenv('DATABASE_NAME') or os.getenv('DATABASE_DATABASE')
DATABASE_USER     = os.getenv('DATABASE_USER') or os.getenv('DATABASE_USERNAME')
DATABASE_PASSWORD = os.getenv('DATABASE_PASSWORD')

if not all([DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD]):
    print("Lipsesc variabilele DB_NAME / DB_USER / DB_PASSWORD din .env")
    print("   Verifică fișierul .env din root-ul proiectului")
    sys.exit(1)


def extract_features(analysis_raw: dict) -> dict | None:
    """
    Extrage features numerice din analysis_raw (JSONB din PostgreSQL).
    Returnează None dacă datele sunt incomplete.
    """
    if not analysis_raw:
        return None

    cv_score    = analysis_raw.get('cvScore', 0) or 0
    github_score = analysis_raw.get('githubScore', 0) or 0
    final_score  = analysis_raw.get('finalScore', 0) or 0
    confidence   = analysis_raw.get('confidenceScore', 0) or 0

    matched_req      = len(analysis_raw.get('matchedRequirements', []) or [])
    missing_req      = len(analysis_raw.get('missingRequirements', []) or [])
    red_flags        = len(analysis_raw.get('redFlags', []) or [])
    evidence_count   = len(analysis_raw.get('evidence', []) or [])
    validated_skills = len(analysis_raw.get('validatedSkills', []) or [])

    github_analysis = analysis_raw.get('githubAnalysis')
    has_github = 1 if github_analysis and github_analysis.get('usedInScoring') else 0

    recommendation = str(analysis_raw.get('recommendation', '') or '').upper()
    if recommendation not in ('INVITA', 'REVIZUIRE', 'RESPINGE'):
        return None

    if final_score == 0 and cv_score == 0:
        return None

    return {
        'cv_score':        int(cv_score),
        'github_score':    int(github_score),
        'final_score':     int(final_score),
        'confidence':      int(confidence),
        'matched_req':     matched_req,
        'missing_req':     missing_req,
        'red_flags':       red_flags,
        'evidence_count':  evidence_count,
        'has_github':      has_github,
        'validated_skills': validated_skills,
        'recommendation':  recommendation,
    }


def main():
    print(f"Conectare la PostgreSQL: {DATABASE_USER}@{DATABASE_HOST}:{DATABASE_PORT}/{DATABASE_NAME}")

    try:
        conn = psycopg2.connect(
            host=DATABASE_HOST,
            port=int(DATABASE_PORT),
            dbname=DATABASE_NAME,
            user=DATABASE_USER,
            password=DATABASE_PASSWORD,
        )
    except Exception as e:
        print(f"Nu mă pot conecta la PostgreSQL: {e}")
        sys.exit(1)

    cursor = conn.cursor()

    cursor.execute("""
    SELECT id, "analysisRaw"
    FROM cv
    WHERE status = 'Analizat'
      AND "analysisRaw" IS NOT NULL
    ORDER BY id
""")

    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    print(f"CV-uri găsite în DB: {len(rows)}")

    samples = []
    skipped = 0

    for cv_id, raw in rows:
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                skipped += 1
                continue

        features = extract_features(raw)
        if features is None:
            skipped += 1
            continue

        samples.append(features)

    if not samples:
        print("Nu au fost extrase date valide. Verifică că CV-urile au analysis_raw complet.")
        sys.exit(0)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    fieldnames = [
        'cv_score', 'github_score', 'final_score', 'confidence',
        'matched_req', 'missing_req', 'red_flags', 'evidence_count',
        'has_github', 'validated_skills', 'recommendation',
    ]

    with open(OUTPUT_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(samples)

    total   = len(samples)
    invita   = sum(1 for s in samples if s['recommendation'] == 'INVITA')
    revizuire = sum(1 for s in samples if s['recommendation'] == 'REVIZUIRE')
    respinge = sum(1 for s in samples if s['recommendation'] == 'RESPINGE')

    print(f"   Exportat {total} exemple reale în: {os.path.abspath(OUTPUT_PATH)}")
    print(f"   INVITA:    {invita:3d} ({invita/total*100:.1f}%)" if total else "")
    print(f"   REVIZUIRE: {revizuire:3d} ({revizuire/total*100:.1f}%)" if total else "")
    print(f"   RESPINGE:  {respinge:3d} ({respinge/total*100:.1f}%)" if total else "")
    if skipped:
        print(f"   Sărite (incomplete/invalide): {skipped}")


if __name__ == '__main__':
    main()