"""
generate_data.py
Generează date sintetice de antrenament bazate pe logica din final-analysis.service.ts
Salvează rezultatul în ml/data/synthetic_data.csv
"""

import random
import csv
import os

random.seed(42)

NUM_SAMPLES = 300
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'synthetic_data.csv')


def compute_recommendation(cv_score, final_score, red_flags, missing_req):
    """
    Replica exactă a logicii din final-analysis.service.ts -> computeRecommendation
    """
    if final_score < 40:
        return 'RESPINGE'
    if red_flags >= 4 and final_score < 70:
        return 'RESPINGE'
    if missing_req >= 6 and final_score < 75:
        return 'REVIZUIRE'
    if final_score >= 75 and red_flags <= 2:
        return 'INVITA'
    if cv_score == 'RESPINGE' and final_score < 55:
        return 'RESPINGE'

    if final_score >= 75:
        return 'INVITA'
    if final_score >= 45:
        return 'REVIZUIRE'
    return 'RESPINGE'


def generate_sample():
    """
    Generează un exemplu sintetic realist.
    Acoperă 3 tipuri de candidați: slab, mediu, bun.
    """
    candidate_type = random.choices(
        ['slab', 'mediu', 'bun'],
        weights=[0.3, 0.4, 0.3]
    )[0]

    if candidate_type == 'slab':
        cv_score        = random.randint(0, 45)
        has_github      = random.choices([0, 1], weights=[0.7, 0.3])[0]
        matched_req     = random.randint(0, 4)
        missing_req     = random.randint(4, 10)
        red_flags       = random.randint(2, 6)
        evidence_count  = random.randint(0, 3)
        validated_skills = random.randint(0, 2)

    elif candidate_type == 'mediu':
        cv_score        = random.randint(45, 74)
        has_github      = random.choices([0, 1], weights=[0.5, 0.5])[0]
        matched_req     = random.randint(3, 8)
        missing_req     = random.randint(2, 6)
        red_flags       = random.randint(0, 3)
        evidence_count  = random.randint(2, 6)
        validated_skills = random.randint(1, 5)

    else: 
        cv_score        = random.randint(70, 100)
        has_github      = random.choices([0, 1], weights=[0.3, 0.7])[0]
        matched_req     = random.randint(6, 15)
        missing_req     = random.randint(0, 3)
        red_flags       = random.randint(0, 2)
        evidence_count  = random.randint(5, 10)
        validated_skills = random.randint(3, 10)

    if has_github:
        if candidate_type == 'slab':
            github_score = random.randint(0, 35)
        elif candidate_type == 'mediu':
            github_score = random.randint(30, 65)
        else:
            github_score = random.randint(55, 100)
    else:
        github_score = 0

    if has_github and github_score > 0:
        final_score = round(cv_score * 0.7 + github_score * 0.3)
    else:
        final_score = cv_score

    final_score = max(0, min(100, final_score))

    confidence = 65
    confidence += min(evidence_count * 2, 12)
    confidence += min(matched_req, 10)
    if has_github:
        confidence += 15 if (validated_skills >= 2 and matched_req > 0) else 8
        confidence += min(validated_skills, 8)
    else:
        confidence -= 5
    confidence = max(45, min(95, confidence))

    recommendation = compute_recommendation(
        cv_score, final_score, red_flags, missing_req
    )

    if random.random() < 0.05:
        recommendation = random.choice(['INVITA', 'REVIZUIRE', 'RESPINGE'])

    return {
        'cv_score':        cv_score,
        'github_score':    github_score,
        'final_score':     final_score,
        'confidence':      confidence,
        'matched_req':     matched_req,
        'missing_req':     missing_req,
        'red_flags':       red_flags,
        'evidence_count':  evidence_count,
        'has_github':      has_github,
        'validated_skills': validated_skills,
        'recommendation':  recommendation,
    }


def main():
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    samples = [generate_sample() for _ in range(NUM_SAMPLES)]

    fieldnames = [
        'cv_score', 'github_score', 'final_score', 'confidence',
        'matched_req', 'missing_req', 'red_flags', 'evidence_count',
        'has_github', 'validated_skills', 'recommendation',
    ]

    with open(OUTPUT_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(samples)

    total = len(samples)
    invita   = sum(1 for s in samples if s['recommendation'] == 'INVITA')
    revizuire = sum(1 for s in samples if s['recommendation'] == 'REVIZUIRE')
    respinge = sum(1 for s in samples if s['recommendation'] == 'RESPINGE')

    print(f"   Generat {total} exemple în: {os.path.abspath(OUTPUT_PATH)}")
    print(f"   INVITA:    {invita:3d} ({invita/total*100:.1f}%)")
    print(f"   REVIZUIRE: {revizuire:3d} ({revizuire/total*100:.1f}%)")
    print(f"   RESPINGE:  {respinge:3d} ({respinge/total*100:.1f}%)")


if __name__ == '__main__':
    main()