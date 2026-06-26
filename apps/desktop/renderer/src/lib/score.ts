export function getScoreLabel(score: number) {
  if (score >= 80) return "Good";
  if (score >= 60) return "Acceptable";
  if (score >= 40) return "Risky";
  return "Poor";
}

export function getAverageReadinessScore(scores: number[]) {
  if (scores.length === 0) {
    return null;
  }

  return Math.round(scores.reduce((total, score) => total + score, 0) / scores.length);
}