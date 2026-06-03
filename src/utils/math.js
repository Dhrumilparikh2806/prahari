// src/utils/math.js
export const cosineSimilarity = (vecA, vecB) => {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += Math.pow(vecA[i], 2);
    normB += Math.pow(vecB[i], 2);
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};
