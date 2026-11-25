/** Standard LeetCode / CP topic categories and smart auto-detection for problem uploads. */
export const STANDARD_TOPICS = [
  "array",
  "hash map",
  "math",
  "string",
  "two pointers",
  "sliding window",
  "binary search",
  "sorting",
  "greedy",
  "dp",
  "graphs",
  "trees",
  "stack",
  "prefix sum",
  "number theory",
  "bit manipulation",
  "matrix",
  "implementation",
  "brute force",
  "data structures",
] as const;

const SPECIAL_LABELS: Record<string, string> = {
  dp: "Dynamic Programming",
  bfs: "BFS",
  dfs: "DFS",
  gcd: "GCD",
};

export function topicLabel(tag: string) {
  const clean = tag.trim().toLowerCase();
  if (SPECIAL_LABELS[clean]) return SPECIAL_LABELS[clean];
  return clean.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const RULES: [string, RegExp][] = [
  ["hash map", /\b(anagram|frequency|distinct|two[- ]sum|duplicate|most frequent|occurrence|hash ?map|dictionary|count.*unique|map)\b/i],
  ["math", /\b(prime|modulo|gcd|divisor|fibonacci|power|sum of|arithmetic|probability|expected|polynomial|factorial|combinator|equation|average|even sum|geometry)\b/i],
  ["number theory", /\b(prime|modulo|gcd|lcm|coprime|divisor|factori[sz]e|sieve|fermat|euler|totient)\b/i],
  ["dp", /\b(dynamic programming|fewest coins|coin change|ways to pay|longest increasing|subsequence|knapsack|maximum subarray|dp\b|minimum cost to reach|number of ways)\b/i],
  ["graphs", /\b(graph|shortest path|island|delivery route|topological|build order|task order|vertex|vertices|edges?|bfs|dfs|dijkstra|connected component|cycle|dag)\b/i],
  ["trees", /\b(tree|binary tree|subtree|ancestor|root|leaf|leaves|lca|diameter)\b/i],
  ["string", /\b(string|palindrome|substring|anagram|character|letter|word|vowel|consonant|lexicograph|prefix|suffix)\b/i],
  ["stack", /\b(bracket|parenthes|balanced|stack|lifo|nested|expression|postfix)\b/i],
  ["two pointers", /\b(two pointer|merge sorted|move zeroes|reverse.*array|sorted array|pair.*sum)\b/i],
  ["sliding window", /\b(sliding window|longest.*substring|contiguous subarray|window of size)\b/i],
  ["binary search", /\b(binary search|first occurrence|sorted.*find|monotonic|minimum.*maximum|minimize the maximum)\b/i],
  ["prefix sum", /\b(range sum|prefix sum|rectangle sum|submatrix sum|2d sum|cumulative)\b/i],
  ["greedy", /\b(greedy|meeting room|interval|schedule|maximize.*profit|minimum number of.*jumps|optimal order)\b/i],
  ["sorting", /\b(sort|sorted|second largest|second best|median|k-?th largest|rank|order by)\b/i],
  ["bit manipulation", /\b(set bits|bitwise|xor|bitmask|binary representation|popcount|power of two)\b/i],
  ["matrix", /\b(grid|matrix|spiral|2d|row.*column|cells? in a)\b/i],
  ["array", /\b(array|sequence of \d* ?integers|list of|elements?|subarray|missing number|maximum element)\b/i],
];

/** Suggests up to 3 topic categories from a problem's title, slug, and statement. */
export function suggestTopics(input: { title?: string; slug?: string; statement?: string; tags?: string[] }): string[] {
  const existing = (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (existing.length > 0) return existing.slice(0, 8);
  const text = `${input.title ?? ""} ${input.slug ?? ""} ${input.statement ?? ""}`;
  const found: string[] = [];
  for (const [topic, pattern] of RULES) {
    if (pattern.test(text)) {
      found.push(topic);
      if (found.length >= 3) break;
    }
  }
  return found.length > 0 ? found : ["implementation"];
}
