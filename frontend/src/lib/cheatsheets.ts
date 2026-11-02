/**
 * The contest reference. Syntax and standard library only, never algorithms or solutions.
 * Edit freely: this file is plain data, and it is loaded separately when the panel first opens.
 */
export type Entry = { title: string; code: string; note?: string };
export type Section = { title: string; entries: Entry[] };

export const SHEETS: Record<string, { name: string; sections: Section[] }> = {
  cpp: {
    name: "C++",
    sections: [
      { title: "Input and output", entries: [
        { title: "Faster cin and cout", code: "ios::sync_with_stdio(false);\ncin.tie(nullptr);", note: "Put this first in main. Then do not mix cin with scanf." },
        { title: "Read until the input ends", code: "int x;\nwhile (cin >> x) {\n    // use x\n}" },
        { title: "Read a whole line", code: "string line;\ngetline(cin, line);", note: "After cin >> x, call cin.ignore() first to skip the rest of the line." },
        { title: "Print with decimals", code: "cout << fixed << setprecision(6) << value << \"\\n\";", note: "Needs <iomanip>." },
        { title: "Avoid endl in big output", code: "cout << x << \"\\n\";", note: "endl flushes every time, which is slow." },
      ] },
      { title: "Numbers and limits", entries: [
        { title: "64-bit integers", code: "long long total = 0;\nlong long big = 1000000000LL * 1000000000LL;", note: "int stops near 2.1e9. Write LL so the multiplication itself is 64-bit." },
        { title: "Limits", code: "INT_MAX  LLONG_MAX  INT_MIN  LLONG_MIN", note: "From <climits>." },
        { title: "Math", code: "sqrt(x); pow(a, b); abs(x); floor(x); ceil(x);\n__gcd(a, b);   // gcd(a, b) from <numeric> in C++17", note: "pow returns a double, so it can be inexact for big integers." },
        { title: "Round up when dividing", code: "long long q = (a + b - 1) / b;   // a, b positive" },
      ] },
      { title: "Strings", entries: [
        { title: "Basics", code: "string s = \"abc\";\ns.size(); s[0]; s += 'd'; s.push_back('e');\ns.substr(start, length);\ns.find(\"bc\");   // string::npos if missing" },
        { title: "Convert", code: "int n = stoi(s);\nlong long m = stoll(s);\nstring t = to_string(n);\nint digit = c - '0';" },
        { title: "Characters", code: "isdigit(c); isalpha(c); isspace(c);\ntoupper(c); tolower(c);" },
      ] },
      { title: "vector and array", entries: [
        { title: "Create", code: "vector<int> v(n);        // n zeros\nvector<int> w(n, -1);    // n times -1\nvector<vector<int>> g(n, vector<int>(m, 0));" },
        { title: "Use", code: "v.push_back(x); v.pop_back();\nv.size(); v.empty(); v.back(); v.front();\nv.clear(); v.resize(k);\nv.insert(v.begin() + i, x); v.erase(v.begin() + i);" },
        { title: "Loop", code: "for (int i = 0; i < (int)v.size(); i++) { }\nfor (auto &x : v) { }" },
      ] },
      { title: "Sort and search", entries: [
        { title: "Sort", code: "sort(v.begin(), v.end());\nsort(v.rbegin(), v.rend());        // descending\nsort(v.begin(), v.end(), greater<int>());" },
        { title: "Sort with a rule", code: "sort(v.begin(), v.end(), [](const auto &a, const auto &b) {\n    return a.second < b.second;\n});", note: "The rule must be strict: use < and never <=." },
        { title: "Binary search on a sorted vector", code: "auto it = lower_bound(v.begin(), v.end(), x);   // first >= x\nauto jt = upper_bound(v.begin(), v.end(), x);   // first > x\nint index = it - v.begin();\nbool found = binary_search(v.begin(), v.end(), x);" },
        { title: "Useful algorithms", code: "reverse(v.begin(), v.end());\n*max_element(v.begin(), v.end());\n*min_element(v.begin(), v.end());\naccumulate(v.begin(), v.end(), 0LL);   // sum, needs <numeric>\nv.erase(unique(v.begin(), v.end()), v.end());   // after sorting\nnext_permutation(v.begin(), v.end());" },
      ] },
      { title: "map and set", entries: [
        { title: "map", code: "map<string, int> m;\nm[\"a\"]++;\nm.count(\"a\");     // 0 or 1\nm.erase(\"a\");\nfor (auto &[key, value] : m) { }", note: "m[key] creates a missing key. Use count or find to only check." },
        { title: "set", code: "set<int> s;\ns.insert(x); s.erase(x); s.count(x);\ns.lower_bound(x);   // iterator to first >= x\n*s.begin(); *s.rbegin();" },
        { title: "Hash versions", code: "unordered_map<int, int> m;\nunordered_set<int> s;", note: "Faster on average, not sorted, and slow on inputs built to attack them." },
        { title: "Allow duplicates", code: "multiset<int> ms;\nms.insert(x);\nms.erase(ms.find(x));   // removes one\nms.erase(x);            // removes all of them" },
      ] },
      { title: "Queue, stack and heap", entries: [
        { title: "queue and stack", code: "queue<int> q;  q.push(x); q.front(); q.pop(); q.empty();\nstack<int> s;  s.push(x); s.top();   s.pop(); s.empty();\ndeque<int> d;  d.push_front(x); d.push_back(x); d.pop_front(); d.pop_back();" },
        { title: "priority_queue", code: "priority_queue<int> maxHeap;\npriority_queue<int, vector<int>, greater<int>> minHeap;\nmaxHeap.push(x); maxHeap.top(); maxHeap.pop();" },
      ] },
      { title: "pair, struct and bits", entries: [
        { title: "pair and tuple", code: "pair<int, int> p = {1, 2};\np.first; p.second;\nauto [a, b] = p;\ntuple<int, int, int> t = {1, 2, 3};\nget<0>(t);" },
        { title: "struct", code: "struct Item {\n    int weight, value;\n    bool operator<(const Item &o) const {\n        return weight < o.weight;\n    }\n};" },
        { title: "Bits", code: "x & y; x | y; x ^ y; ~x;\nx << k; x >> k;\n(x >> k) & 1;           // bit k\n__builtin_popcountll(x); // number of 1 bits", note: "Write 1LL << k when k can reach 31 or more." },
      ] },
    ],
  },
  java: {
    name: "Java",
    sections: [
      { title: "Program shape", entries: [
        { title: "The class must be named Main", code: "import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n    }\n}" },
      ] },
      { title: "Input and output", entries: [
        { title: "Fast input", code: "BufferedReader in = new BufferedReader(new InputStreamReader(System.in));\nStringTokenizer st = new StringTokenizer(in.readLine());\nint a = Integer.parseInt(st.nextToken());\nlong b = Long.parseLong(st.nextToken());", note: "readLine returns null when the input ends." },
        { title: "Read numbers across lines", code: "StreamTokenizer t = new StreamTokenizer(in);\nt.nextToken();\nint n = (int) t.nval;", note: "nval is a double, so very large long values lose precision." },
        { title: "Simple input", code: "Scanner sc = new Scanner(System.in);\nint n = sc.nextInt();\nString s = sc.next();\nString line = sc.nextLine();", note: "Scanner is easy but slow on large inputs." },
        { title: "Fast output", code: "PrintWriter out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(System.out)));\nout.println(x);\nout.printf(\"%.6f%n\", value);\nout.flush();", note: "Without flush at the end, you can lose output." },
      ] },
      { title: "Numbers and strings", entries: [
        { title: "Numbers", code: "long total = 1_000_000_000L * 1_000_000_000L;\nInteger.MAX_VALUE; Long.MAX_VALUE;\nMath.max(a, b); Math.min(a, b); Math.abs(a);\nMath.sqrt(x); Math.pow(a, b); Math.floor(x); Math.ceil(x);\nMath.floorMod(a, m);   // never negative" },
        { title: "String", code: "s.length(); s.charAt(i); s.substring(from, to);\ns.indexOf(\"x\"); s.contains(\"x\"); s.trim();\ns.split(\" \"); s.toCharArray();\ns.equals(t);     // not ==\ns.compareTo(t);", note: "Use equals for content: == compares objects." },
        { title: "Build strings", code: "StringBuilder sb = new StringBuilder();\nsb.append(x).append('\\n');\nsb.reverse();\nsb.toString();", note: "Adding to a String in a loop is slow." },
        { title: "Convert", code: "int n = Integer.parseInt(s);\nString t = String.valueOf(n);\nint digit = c - '0';\nCharacter.isDigit(c); Character.isLetter(c);" },
      ] },
      { title: "Arrays and sorting", entries: [
        { title: "Arrays", code: "int[] a = new int[n];\nint[][] g = new int[n][m];\nArrays.fill(a, -1);\nArrays.sort(a);\nArrays.toString(a);" },
        { title: "Sorting objects", code: "Integer[] b = new Integer[n];\nArrays.sort(b, Collections.reverseOrder());\nlist.sort((x, y) -> x[0] - y[0]);\nlist.sort(Comparator.comparingInt(x -> x[0]));", note: "Primitive arrays can't take a comparator. x - y can overflow on huge values, so use Integer.compare." },
        { title: "Binary search", code: "int i = Arrays.binarySearch(a, x);   // negative if missing\nint j = Collections.binarySearch(list, x);" },
      ] },
      { title: "Collections", entries: [
        { title: "List", code: "List<Integer> v = new ArrayList<>();\nv.add(x); v.get(i); v.set(i, x); v.size();\nv.remove(v.size() - 1);\nCollections.sort(v);\nCollections.reverse(v);", note: "v.remove(int) removes by position. To remove a value, use v.remove(Integer.valueOf(x))." },
        { title: "Map", code: "Map<String, Integer> m = new HashMap<>();\nm.put(k, v); m.get(k); m.containsKey(k); m.remove(k);\nm.getOrDefault(k, 0);\nm.merge(k, 1, Integer::sum);\nfor (Map.Entry<String, Integer> e : m.entrySet()) { e.getKey(); e.getValue(); }", note: "TreeMap keeps keys sorted, with floorKey and ceilingKey." },
        { title: "Set", code: "Set<Integer> s = new HashSet<>();\ns.add(x); s.contains(x); s.remove(x);\nTreeSet<Integer> t = new TreeSet<>();\nt.first(); t.last(); t.floor(x); t.ceiling(x);" },
        { title: "Queue, stack and heap", code: "Deque<Integer> d = new ArrayDeque<>();\nd.addLast(x); d.pollFirst(); d.peekFirst();   // queue\nd.addFirst(x); d.pollFirst();                 // stack\nPriorityQueue<Integer> h = new PriorityQueue<>();\nPriorityQueue<Integer> maxH = new PriorityQueue<>(Collections.reverseOrder());\nh.add(x); h.peek(); h.poll();" },
        { title: "Comparing boxed numbers", code: "a.equals(b)      // Integer, Long\n(int) a == (int) b", note: "== on Integer objects is unreliable outside -128 to 127." },
      ] },
    ],
  },
  python: {
    name: "Python",
    sections: [
      { title: "Input and output", entries: [
        { title: "Read numbers from a line", code: "n = int(input())\na, b = map(int, input().split())\nvalues = list(map(int, input().split()))" },
        { title: "Fast input", code: "import sys\ndata = sys.stdin.read().split()\nn = int(data[0])\n\n# or one line at a time\ninput = sys.stdin.readline", note: "readline keeps the line ending, so use .strip() on text." },
        { title: "Print", code: "print(a, b)\nprint(*values)            # separated by spaces\nprint(\"\\n\".join(map(str, values)))\nprint(f\"{x:.6f}\")", note: "Build one string for big output: many print calls are slow." },
      ] },
      { title: "Numbers", entries: [
        { title: "Math", code: "a // b    # integer division, rounds down\na % b\na ** b\npow(a, b, m)   # a^b modulo m\nabs(x); min(a, b); max(a, b); sum(values)\ndivmod(a, b)", note: "Integers never overflow, but very big ones are slow." },
        { title: "math module", code: "import math\nmath.sqrt(x); math.isqrt(n); math.floor(x); math.ceil(x)\nmath.gcd(a, b); math.log2(x)\nfloat(\"inf\"); math.pi" },
      ] },
      { title: "Strings", entries: [
        { title: "Basics", code: "s[i]; s[a:b]; s[::-1]; len(s)\ns.split(); s.strip(); s.replace(\"a\", \"b\")\ns.find(\"x\")     # -1 if missing\n\" \".join(words)\ns.upper(); s.lower(); s.isdigit(); s.isalpha()" },
        { title: "Characters", code: "ord(\"a\")        # 97\nchr(97)         # \"a\"\nint(c)", note: "Strings can't change. Use a list of characters, then \"\".join it." },
      ] },
      { title: "Lists", entries: [
        { title: "Create", code: "a = [0] * n\ngrid = [[0] * m for _ in range(n)]\nsquares = [x * x for x in values if x > 0]", note: "Don't write [[0] * m] * n: every row would be the same list." },
        { title: "Use", code: "a.append(x); a.pop(); a.pop(0)\na.insert(i, x); a.remove(x); a.index(x)\na.reverse(); a[-1]; a[i:j]; len(a)\nx in a", note: "a.pop(0), a.insert(0, x) and x in a are slow on long lists." },
        { title: "Sort", code: "a.sort()\na.sort(reverse=True)\nb = sorted(a)\na.sort(key=lambda x: (x[1], -x[0]))" },
        { title: "Loops", code: "for i in range(n): ...\nfor i in range(n - 1, -1, -1): ...\nfor i, x in enumerate(a): ...\nfor x, y in zip(a, b): ..." },
      ] },
      { title: "dict and set", entries: [
        { title: "dict", code: "d = {}\nd[k] = v; d.get(k, 0); k in d; del d[k]\nfor k, v in d.items(): ..." },
        { title: "set", code: "s = set()\ns.add(x); s.discard(x); x in s\na | b; a & b; a - b" },
        { title: "collections", code: "from collections import defaultdict, Counter, deque\ncount = defaultdict(int)\ngraph = defaultdict(list)\nCounter(values).most_common(3)" },
      ] },
      { title: "Queue and heap", entries: [
        { title: "deque", code: "from collections import deque\nq = deque()\nq.append(x); q.popleft(); q.appendleft(x); q.pop()", note: "Use this for a queue, not list.pop(0)." },
        { title: "heapq", code: "import heapq\nh = []\nheapq.heappush(h, x)\nheapq.heappop(h)     # smallest\nh[0]                 # peek\nheapq.heapify(values)", note: "Only a min-heap. For a max-heap, store -x." },
        { title: "bisect on a sorted list", code: "from bisect import bisect_left, bisect_right\ni = bisect_left(a, x)    # first >= x\nj = bisect_right(a, x)   # first > x" },
      ] },
      { title: "Other useful things", entries: [
        { title: "Recursion limit", code: "import sys\nsys.setrecursionlimit(300000)", note: "Deep recursion can still crash, so a loop is safer." },
        { title: "Combinations", code: "from itertools import permutations, combinations, product\nfor p in permutations(a): ...\nfor c in combinations(a, 2): ..." },
      ] },
    ],
  },
  c: {
    name: "C",
    sections: [
      { title: "Input and output", entries: [
        { title: "Read and print", code: "int n; long long x; double d; char s[1005];\nscanf(\"%d %lld %lf %1004s\", &n, &x, &d, s);\nprintf(\"%d %lld %.6f %s\\n\", n, x, d, s);", note: "Read a double with %lf and print it with %f. A string needs no &." },
        { title: "Read until the input ends", code: "int x;\nwhile (scanf(\"%d\", &x) == 1) {\n    // use x\n}" },
        { title: "Read a whole line", code: "char line[1005];\nfgets(line, sizeof line, stdin);\nline[strcspn(line, \"\\n\")] = '\\0';", note: "After scanf, the rest of the previous line is still waiting to be read." },
      ] },
      { title: "Numbers", entries: [
        { title: "64-bit integers", code: "long long total = 0;\nlong long big = 1000000000LL * 1000000000LL;", note: "From <limits.h>: INT_MAX, LLONG_MAX." },
        { title: "Math", code: "#include <math.h>\nsqrt(x); pow(a, b); floor(x); ceil(x); fabs(x);\n#include <stdlib.h>\nabs(a); llabs(a);", note: "This judge compiles C without -lm, so math functions on variables may fail with a compilation error. Prefer integer arithmetic, or use C++." },
      ] },
      { title: "Arrays and memory", entries: [
        { title: "Arrays", code: "int a[100005];            // global: starts at zero\nint grid[1005][1005];\nmemset(a, 0, sizeof a);    // from <string.h>", note: "Put big arrays outside main: a large local array can overflow the stack." },
        { title: "Allocate", code: "int *a = malloc(n * sizeof *a);\nint *b = calloc(n, sizeof *b);   // starts at zero\nfree(a);" },
      ] },
      { title: "Strings", entries: [
        { title: "Basics", code: "strlen(s); strcmp(a, b);     // 0 when equal\nstrcpy(to, from); strcat(to, from);\nstrchr(s, 'x'); strstr(s, \"ab\");", note: "Compare with strcmp: == compares addresses. strlen in a loop condition is slow." },
        { title: "Characters", code: "#include <ctype.h>\nisdigit(c); isalpha(c); isspace(c);\ntoupper(c); tolower(c);\nint digit = c - '0';" },
        { title: "Convert", code: "int n = atoi(s);\nlong long m = atoll(s);\nchar out[32];\nsprintf(out, \"%d\", n);" },
      ] },
      { title: "Sort and search", entries: [
        { title: "qsort", code: "int cmp(const void *x, const void *y) {\n    int a = *(const int *)x, b = *(const int *)y;\n    return (a > b) - (a < b);\n}\n\nqsort(a, n, sizeof a[0], cmp);", note: "Don't return a - b: it can overflow." },
        { title: "bsearch", code: "int *found = bsearch(&key, a, n, sizeof a[0], cmp);   // NULL if missing" },
      ] },
      { title: "struct and bits", entries: [
        { title: "struct", code: "typedef struct {\n    int weight, value;\n} Item;\n\nItem items[1005];\nitems[0].weight = 3;" },
        { title: "Bits", code: "x & y; x | y; x ^ y; ~x;\nx << k; x >> k;\n(x >> k) & 1;             // bit k\n__builtin_popcountll(x);  // number of 1 bits", note: "Write 1LL << k when k can reach 31 or more." },
      ] },
    ],
  },
  javascript: {
    name: "JavaScript",
    sections: [
      { title: "Input and output", entries: [
        { title: "Read everything", code: "const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/);\nlet pos = 0;\nconst n = Number(data[pos++]);" },
        { title: "Read by lines", code: "const lines = require('fs').readFileSync(0, 'utf8').split('\\n');\nconst [a, b] = lines[0].trim().split(' ').map(Number);" },
        { title: "Print", code: "console.log(x);\nconst out = [];\nout.push(x);\nconsole.log(out.join('\\n'));\nconsole.log(value.toFixed(6));", note: "Collect big output and print it once: many console.log calls are slow." },
      ] },
      { title: "Numbers", entries: [
        { title: "Size of numbers", code: "Number.MAX_SAFE_INTEGER;    // about 9e15\nconst big = 1000000000n * 1000000000n;\nBigInt(5) + 2n;\nNumber(big);", note: "Numbers lose precision past 9e15. Use BigInt, and don't mix it with Number." },
        { title: "Math", code: "Math.floor(a / b);   // integer division\na % b;               // can be negative\nMath.abs(x); Math.min(a, b); Math.max(a, b);\nMath.sqrt(x); Math.pow(a, b);\nMath.max(...arr);", note: "Math.max(...arr) can crash on very long arrays, so loop instead." },
      ] },
      { title: "Strings", entries: [
        { title: "Basics", code: "s.length; s[i]; s.slice(a, b);\ns.split(' '); s.trim(); s.indexOf('x'); s.includes('x');\ns.toUpperCase(); s.toLowerCase(); s.repeat(3);\ns.charCodeAt(i); String.fromCharCode(97);", note: "Strings can't change. Use an array of characters, then join it." },
        { title: "Convert", code: "Number(s); parseInt(s, 10); String(n);\narr.join(' ');" },
      ] },
      { title: "Arrays", entries: [
        { title: "Create", code: "const a = new Array(n).fill(0);\nconst grid = Array.from({ length: n }, () => new Array(m).fill(0));", note: "Don't use new Array(n).fill([]): every slot would be the same array." },
        { title: "Use", code: "a.push(x); a.pop(); a.length;\na.shift(); a.unshift(x);\na.slice(i, j); a.reverse(); a.includes(x); a.indexOf(x);\na.map(f); a.filter(f); a.reduce((s, x) => s + x, 0);", note: "shift and unshift are slow on long arrays. Use an index as the front of a queue." },
        { title: "Sort", code: "a.sort((x, y) => x - y);    // numbers\na.sort((x, y) => y - x);    // descending\na.sort((p, q) => p[0] - q[0]);", note: "Without a function, sort compares as text, so 10 comes before 9." },
      ] },
      { title: "Map and Set", entries: [
        { title: "Map", code: "const m = new Map();\nm.set(k, v); m.get(k); m.has(k); m.delete(k); m.size;\nm.set(k, (m.get(k) ?? 0) + 1);\nfor (const [k, v] of m) { }", note: "Keeps insertion order, not sorted order. There is no built-in heap or sorted map." },
        { title: "Set", code: "const s = new Set();\ns.add(x); s.has(x); s.delete(x); s.size;\nfor (const x of s) { }\nconst unique = [...new Set(a)];" },
      ] },
    ],
  },
  go: {
    name: "Go",
    sections: [
      { title: "Input and output", entries: [
        { title: "Fast input and output", code: "in := bufio.NewReader(os.Stdin)\nout := bufio.NewWriter(os.Stdout)\ndefer out.Flush()\n\nvar n int\nfmt.Fscan(in, &n)\nfmt.Fprintln(out, n)", note: "Imports: bufio, fmt, os. Without Flush you lose the output." },
        { title: "Read until the input ends", code: "var x int\nfor {\n    if _, err := fmt.Fscan(in, &x); err != nil {\n        break\n    }\n}" },
        { title: "Print", code: "fmt.Fprintf(out, \"%d %s %.6f\\n\", n, s, value)" },
      ] },
      { title: "Numbers", entries: [
        { title: "Types", code: "var a int        // 64-bit on this judge\nvar b int64 = 1000000000 * 1000000000\nfloat64(a); int(d); int64(a)\nmath.MaxInt64", note: "Types never convert by themselves, so int + int64 is a compilation error. An unused import or variable is also an error." },
        { title: "Math", code: "math.Sqrt(x); math.Pow(a, b); math.Abs(x)\nmath.Floor(x); math.Ceil(x)\nmath.Inf(1)", note: "These all use float64." },
      ] },
      { title: "Strings", entries: [
        { title: "Basics", code: "len(s); s[i]; s[a:b]\nstrings.Split(s, \" \"); strings.Fields(s)\nstrings.TrimSpace(s); strings.Contains(s, \"x\")\nstrings.Join(parts, \" \"); strings.Repeat(\"a\", 3)\nfor i, r := range s { }", note: "s[i] is a byte, and range gives runes." },
        { title: "Convert", code: "n, _ := strconv.Atoi(s)\nt := strconv.Itoa(n)\nbytes := []byte(s); text := string(bytes)" },
        { title: "Build strings", code: "var sb strings.Builder\nsb.WriteString(\"abc\")\nsb.WriteByte('d')\nsb.String()" },
      ] },
      { title: "Slices", entries: [
        { title: "Create", code: "a := make([]int, n)\ngrid := make([][]int, n)\nfor i := range grid {\n    grid[i] = make([]int, m)\n}" },
        { title: "Use", code: "a = append(a, x)\na = a[:len(a)-1]       // remove last\na = a[1:]              // remove first\nlen(a)\nb := make([]int, len(a))\ncopy(b, a)", note: "b := a shares the same data: use copy for a real copy." },
        { title: "Sort and search", code: "sort.Ints(a); sort.Strings(words)\nsort.Slice(p, func(i, j int) bool {\n    return p[i].x < p[j].x\n})\ni := sort.SearchInts(a, x)   // first >= x" },
      ] },
      { title: "map and struct", entries: [
        { title: "map", code: "m := make(map[string]int)\nm[k]++\nv, ok := m[k]\ndelete(m, k)\nlen(m)\nfor k, v := range m { }", note: "Loop order is random. Go has no set type: use map[int]bool." },
        { title: "struct", code: "type Item struct {\n    weight, value int\n}\n\nitems := []Item{{1, 2}, {3, 4}}\nitems[0].weight = 5" },
        { title: "Heap", code: "import \"container/heap\"", note: "You implement Len, Less, Swap, Push and Pop on your own type, then call heap.Push and heap.Pop." },
      ] },
    ],
  },
  rust: {
    name: "Rust",
    sections: [
      { title: "Input and output", entries: [
        { title: "Read everything", code: "use std::io::{self, Read};\n\nlet mut input = String::new();\nio::stdin().read_to_string(&mut input).unwrap();\nlet mut it = input.split_ascii_whitespace();\nlet n: usize = it.next().unwrap().parse().unwrap();" },
        { title: "Fast output", code: "use std::io::{self, Write};\n\nlet stdout = io::stdout();\nlet mut out = io::BufWriter::new(stdout.lock());\nwriteln!(out, \"{}\", x).unwrap();", note: "println! flushes often, so it is slow for big output." },
        { title: "Formatting", code: "println!(\"{} {}\", a, b);\nprintln!(\"{:.6}\", value);\nprintln!(\"{:?}\", list);   // debug view" },
      ] },
      { title: "Numbers", entries: [
        { title: "Types", code: "let a: i64 = 1_000_000_000 * 1_000_000_000;\nlet index = a as usize;\nlet d = a as f64;\ni64::MAX; i32::MAX;", note: "Indexes must be usize. Numbers don't convert by themselves, so use as." },
        { title: "Math", code: "x.abs(); a.min(b); a.max(b); a.pow(3);\nd.sqrt(); d.floor(); d.ceil(); d.powi(2);\na.rem_euclid(m);    // never negative" },
      ] },
      { title: "Strings", entries: [
        { title: "Basics", code: "let mut s = String::new();\ns.push('a'); s.push_str(\"bc\");\ns.len(); s.trim();\ns.split(' '); s.split_whitespace();\nlet chars: Vec<char> = s.chars().collect();\nlet bytes = s.as_bytes();", note: "You can't write s[i]. Use a Vec<char> or as_bytes for positions." },
        { title: "Convert", code: "let n: i32 = s.parse().unwrap();\nlet t = n.to_string();\nlet digit = c.to_digit(10).unwrap();\nlet text: String = chars.iter().collect();" },
      ] },
      { title: "Vec", entries: [
        { title: "Create", code: "let mut v = vec![0; n];\nlet mut grid = vec![vec![0; m]; n];\nlet mut w: Vec<i64> = Vec::new();" },
        { title: "Use", code: "v.push(x); v.pop(); v.len(); v.is_empty();\nv.iter().sum::<i64>();\nv.iter().max(); v.iter().min();\nfor x in &v { }\nfor (i, x) in v.iter().enumerate() { }" },
        { title: "Sort and search", code: "v.sort(); v.sort_unstable();\nv.sort_by(|a, b| b.cmp(a));        // descending\nv.sort_by_key(|p| p.0);\nv.dedup();                         // after sorting\nv.binary_search(&x);               // Ok(i) or Err(i)\nv.partition_point(|&y| y < x);     // first >= x\nv.reverse();" },
      ] },
      { title: "Collections", entries: [
        { title: "Maps", code: "use std::collections::{HashMap, BTreeMap};\nlet mut m = HashMap::new();\n*m.entry(k).or_insert(0) += 1;\nm.get(&k); m.contains_key(&k); m.remove(&k);\nfor (k, v) in &m { }", note: "BTreeMap has the same basics and keeps keys sorted." },
        { title: "Sets", code: "use std::collections::{HashSet, BTreeSet};\nlet mut s = HashSet::new();\ns.insert(x); s.contains(&x); s.remove(&x);" },
        { title: "Queue and heap", code: "use std::collections::{VecDeque, BinaryHeap};\nuse std::cmp::Reverse;\nlet mut q = VecDeque::new();\nq.push_back(x); q.pop_front();\nlet mut h = BinaryHeap::new();    // largest first\nh.push(x); h.pop(); h.peek();\nh.push(Reverse(x));               // smallest first" },
      ] },
    ],
  },
  kotlin: {
    name: "Kotlin",
    sections: [
      { title: "Input and output", entries: [
        { title: "Read", code: "val n = readln().trim().toInt()\nval values = readln().trim().split(\" \").map { it.toInt() }\nval (a, b) = readln().trim().split(\" \").map { it.toLong() }" },
        { title: "Read everything", code: "val data = System.`in`.bufferedReader().readText().trim().split(Regex(\"\\\\s+\"))\nvar pos = 0\nval n = data[pos++].toInt()" },
        { title: "Print", code: "println(x)\nval sb = StringBuilder()\nsb.append(x).append('\\n')\nprint(sb)\nprintln(\"%.6f\".format(value))", note: "Collect big output in a StringBuilder: many println calls are slow." },
      ] },
      { title: "Numbers", entries: [
        { title: "Types", code: "val total: Long = 1_000_000_000L * 1_000_000_000L\nx.toLong(); x.toInt(); x.toDouble()\nInt.MAX_VALUE; Long.MAX_VALUE", note: "Int + Long gives a Long, and a Long won't fit an Int variable without toInt()." },
        { title: "Math", code: "maxOf(a, b); minOf(a, b)\nimport kotlin.math.*\nabs(x); sqrt(d); floor(d); ceil(d); d.pow(2)\na.mod(m)     // never negative" },
      ] },
      { title: "Strings", entries: [
        { title: "Basics", code: "s.length; s[i]; s.substring(a, b)\ns.split(\" \"); s.trim(); s.indexOf(\"x\"); s.contains(\"x\")\ns.uppercase(); s.lowercase(); s.reversed()\ns.toCharArray(); s == t", note: "== compares content in Kotlin." },
        { title: "Convert", code: "s.toInt(); s.toLong(); n.toString()\nc.digitToInt(); c.isDigit(); c.isLetter()\nlist.joinToString(\" \")" },
      ] },
      { title: "Lists and arrays", entries: [
        { title: "Create", code: "val a = IntArray(n)\nval b = LongArray(n) { -1L }\nval grid = Array(n) { IntArray(m) }\nval list = mutableListOf<Int>()" },
        { title: "Use", code: "list.add(x); list[i]; list.size; list.isEmpty()\nlist.removeAt(list.size - 1)\nlist.sum(); a.sum(); list.maxOrNull(); list.minOrNull()\nfor (i in 0 until n) { }\nfor (i in n - 1 downTo 0) { }\nfor ((i, x) in list.withIndex()) { }" },
        { title: "Sort", code: "a.sort()\nlist.sort(); list.sortDescending()\nlist.sortBy { it.first }\nval sorted = list.sorted()\nlist.binarySearch(x)     // negative if missing" },
      ] },
      { title: "Collections", entries: [
        { title: "Map", code: "val m = HashMap<String, Int>()\nm[k] = (m[k] ?: 0) + 1\nm.getOrDefault(k, 0); k in m; m.remove(k)\nfor ((k, v) in m) { }\nval sortedMap = java.util.TreeMap<Int, Int>()" },
        { title: "Set", code: "val s = HashSet<Int>()\ns.add(x); x in s; s.remove(x)\nval t = java.util.TreeSet<Int>()\nt.first(); t.floor(x); t.ceiling(x)" },
        { title: "Queue and heap", code: "val q = ArrayDeque<Int>()\nq.addLast(x); q.removeFirst(); q.first()\nval h = java.util.PriorityQueue<Int>()\nval maxH = java.util.PriorityQueue<Int>(compareByDescending { it })\nh.add(x); h.peek(); h.poll()" },
      ] },
    ],
  },
  csharp: {
    name: "C#",
    sections: [
      { title: "Program shape", entries: [
        { title: "Starting point", code: "using System;\nusing System.Collections.Generic;\nusing System.Linq;\n\nclass Program {\n    static void Main() {\n    }\n}", note: "This judge compiles with Mono, so newer C# features may not be available." },
      ] },
      { title: "Input and output", entries: [
        { title: "Read", code: "int n = int.Parse(Console.ReadLine());\nint[] a = Console.ReadLine().Split(' ').Select(int.Parse).ToArray();\nstring[] data = Console.In.ReadToEnd().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);" },
        { title: "Print", code: "Console.WriteLine(x);\nConsole.WriteLine(string.Join(\" \", a));\nConsole.WriteLine(value.ToString(\"F6\", System.Globalization.CultureInfo.InvariantCulture));" },
        { title: "Fast output", code: "var sb = new System.Text.StringBuilder();\nsb.Append(x).Append('\\n');\nConsole.Write(sb);", note: "Collect big output and write it once." },
      ] },
      { title: "Numbers and strings", entries: [
        { title: "Numbers", code: "long total = 1000000000L * 1000000000L;\nint.MaxValue; long.MaxValue;\nMath.Max(a, b); Math.Min(a, b); Math.Abs(x);\nMath.Sqrt(x); Math.Pow(a, b); Math.Floor(x); Math.Ceiling(x);" },
        { title: "Strings", code: "s.Length; s[i]; s.Substring(start, length);\ns.Split(' '); s.Trim(); s.IndexOf(\"x\"); s.Contains(\"x\");\ns.ToUpper(); s.ToLower(); s == t;\nchar[] c = s.ToCharArray(); new string(c);", note: "Strings can't change, so adding to one in a loop is slow. Use StringBuilder." },
        { title: "Convert", code: "int.Parse(s); long.Parse(s); n.ToString();\nint digit = c - '0';\nchar.IsDigit(c); char.IsLetter(c);" },
      ] },
      { title: "Arrays and lists", entries: [
        { title: "Create", code: "int[] a = new int[n];\nint[,] grid = new int[n, m];\ngrid[0, 1] = 5;\nvar list = new List<int>();" },
        { title: "Use", code: "list.Add(x); list[i]; list.Count;\nlist.RemoveAt(list.Count - 1);\nlist.Contains(x); list.Sum(); list.Max(); list.Min();\nforeach (var x in list) { }" },
        { title: "Sort and search", code: "Array.Sort(a); Array.Reverse(a);\nlist.Sort();\nlist.Sort((x, y) => y.CompareTo(x));   // descending\nArray.BinarySearch(a, x);              // negative if missing\nlist.BinarySearch(x);" },
      ] },
      { title: "Collections", entries: [
        { title: "Dictionary", code: "var m = new Dictionary<string, int>();\nm[k] = 1; m.ContainsKey(k); m.Remove(k);\nint v;\nif (m.TryGetValue(k, out v)) { }\nforeach (var e in m) { var key = e.Key; var value = e.Value; }", note: "m[k] throws an error for a missing key. SortedDictionary keeps keys sorted." },
        { title: "Set", code: "var s = new HashSet<int>();\ns.Add(x); s.Contains(x); s.Remove(x);\nvar t = new SortedSet<int>();\nt.Min; t.Max;" },
        { title: "Queue and stack", code: "var q = new Queue<int>();\nq.Enqueue(x); q.Dequeue(); q.Peek(); q.Count;\nvar st = new Stack<int>();\nst.Push(x); st.Pop(); st.Peek();", note: "Mono has no PriorityQueue. A SortedSet of (value, id) pairs works like a heap." },
      ] },
    ],
  },
  ruby: {
    name: "Ruby",
    sections: [
      { title: "Input and output", entries: [
        { title: "Read", code: "n = gets.to_i\na, b = gets.split.map(&:to_i)\nvalues = gets.split.map(&:to_i)\ndata = STDIN.read.split.map(&:to_i)" },
        { title: "Print", code: "puts x\nputs values.join(\" \")\nprintf(\"%.6f\\n\", value)\nputs format(\"%.6f\", value)", note: "Join big output into one string: many puts calls are slow." },
      ] },
      { title: "Numbers", entries: [
        { title: "Math", code: "a / b          # rounds down for integers\na % b; a ** b; a.pow(b, m)\na.abs; [a, b].max; [a, b].min\na.gcd(b); Math.sqrt(x); Integer.sqrt(n)\nx.floor; x.ceil; x.round(6)", note: "Integers never overflow, but very big ones are slow." },
      ] },
      { title: "Strings", entries: [
        { title: "Basics", code: "s.length; s[i]; s[a, count]; s.reverse\ns.split; s.strip; s.chomp; s.sub(\"a\", \"b\"); s.gsub(\"a\", \"b\")\ns.include?(\"x\"); s.index(\"x\"); s.upcase; s.downcase\ns.chars; s << \"more\"", note: "index returns nil when nothing is found." },
        { title: "Convert", code: "s.to_i; s.to_f; n.to_s\nc.ord; 97.chr\narr.join(\" \")" },
      ] },
      { title: "Arrays", entries: [
        { title: "Create", code: "a = Array.new(n, 0)\ngrid = Array.new(n) { Array.new(m, 0) }", note: "Don't write Array.new(n, []): every slot would be the same array." },
        { title: "Use", code: "a.push(x); a << x; a.pop; a.shift; a.unshift(x)\na.size; a.first; a.last; a[-1]; a[i, count]\na.sum; a.max; a.min; a.include?(x); a.uniq; a.reverse\na.map { |x| x * 2 }; a.select { |x| x > 0 }" },
        { title: "Sort and search", code: "a.sort; a.sort!\na.sort_by { |x| [x[1], -x[0]] }\na.sort { |x, y| y <=> x }\na.bsearch { |x| x >= target }   # on a sorted array" },
        { title: "Loops", code: "n.times { |i| }\n(0...n).each { |i| }\n(n - 1).downto(0) { |i| }\na.each_with_index { |x, i| }" },
      ] },
      { title: "Hash and Set", entries: [
        { title: "Hash", code: "h = Hash.new(0)\nh[k] += 1\nh.key?(k); h.delete(k); h.keys; h.values; h.size\nh.each { |k, v| }" },
        { title: "Set", code: "require \"set\"\ns = Set.new\ns.add(x); s.include?(x); s.delete(x)", note: "Ruby has no built-in heap. For a queue, keep an index instead of calling shift on very long arrays if it gets slow." },
      ] },
    ],
  },
  php: {
    name: "PHP",
    sections: [
      { title: "Input and output", entries: [
        { title: "Read", code: "$n = (int) trim(fgets(STDIN));\n$values = array_map('intval', explode(' ', trim(fgets(STDIN))));\nfscanf(STDIN, \"%d %d\", $a, $b);\n$data = preg_split('/\\s+/', trim(stream_get_contents(STDIN)));" },
        { title: "Print", code: "echo $x, \"\\n\";\necho implode(' ', $values), \"\\n\";\nprintf(\"%.6f\\n\", $value);", note: "Remember the opening <?php at the top of the file." },
      ] },
      { title: "Numbers", entries: [
        { title: "Math", code: "intdiv($a, $b);    // integer division\n$a % $b; $a ** $b;\nabs($x); max($a, $b); min($a, $b); max($values);\nsqrt($x); floor($x); ceil($x); round($x, 6);\nPHP_INT_MAX;", note: "/ can return a decimal. An integer that overflows silently becomes a float." },
      ] },
      { title: "Strings", entries: [
        { title: "Basics", code: "strlen($s); $s[$i]; substr($s, $start, $length);\nexplode(' ', $s); implode(' ', $parts); trim($s);\nstrpos($s, 'x'); str_replace('a', 'b', $s);\nstrtoupper($s); strtolower($s); strrev($s); str_repeat('a', 3);\nstr_split($s);", note: "strpos returns false when missing and 0 at the start, so compare with === false." },
        { title: "Convert", code: "(int) $s; (float) $s; (string) $n; intval($s);\nord($c); chr(97);\nctype_digit($s); ctype_alpha($s);" },
      ] },
      { title: "Arrays", entries: [
        { title: "Create", code: "$a = array_fill(0, $n, 0);\n$grid = array_fill(0, $n, array_fill(0, $m, 0));\n$list = [];" },
        { title: "Use", code: "$a[] = $x; array_pop($a); array_shift($a); array_unshift($a, $x);\ncount($a); array_sum($a); in_array($x, $a); array_reverse($a);\narray_slice($a, $i, $length); array_unique($a);\narray_map(fn($x) => $x * 2, $a);\nforeach ($a as $i => $x) { }", note: "array_shift and in_array are slow on long arrays." },
        { title: "Sort", code: "sort($a); rsort($a);\nusort($a, fn($x, $y) => $x[0] <=> $y[0]);\nasort($m); ksort($m);    // keep keys" },
        { title: "As a map or set", code: "$m = [];\n$m[$k] = ($m[$k] ?? 0) + 1;\nisset($m[$k]); unset($m[$k]);\nforeach ($m as $k => $v) { }", note: "isset on keys is much faster than in_array." },
      ] },
      { title: "Queue and heap", entries: [
        { title: "Built-in structures", code: "$q = new SplQueue();\n$q->enqueue($x); $q->dequeue(); $q->isEmpty();\n$h = new SplMinHeap();    // or SplMaxHeap\n$h->insert($x); $h->extract(); $h->top();" },
      ] },
    ],
  },
};

SHEETS.zig = {
  name: "Zig",
  sections: [
    { title: "Input and output", entries: [
      { title: "Read all input as numbers", code: "var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);\nconst allocator = arena.allocator();\nconst input = try std.io.getStdIn().readToEndAlloc(allocator, 1 << 30);\nvar tokens = std.mem.tokenizeAny(u8, input, \" \\r\\n\\t\");\nconst n = try std.fmt.parseInt(i64, tokens.next().?, 10);", note: "Zig 0.13. The arena frees everything when the program ends." },
      { title: "Buffered output", code: "var buffered = std.io.bufferedWriter(std.io.getStdOut().writer());\nconst out = buffered.writer();\ntry out.print(\"{d} {s}\\n\", .{ x, name });\ntry buffered.flush();", note: "Forgetting flush() prints nothing." },
    ] },
    { title: "Numbers", entries: [
      { title: "Integer types", code: "const a: i32 = 5;\nconst b: i64 = @as(i64, a) * 1000000000;\nconst c: usize = @intCast(b);\nconst d: f64 = @floatFromInt(a);", note: "Overflow is a runtime error in the judge (ReleaseSafe); use +% for wrapping." },
      { title: "Math", code: "@max(a, b); @min(a, b); @abs(x);\n@divTrunc(a, b); @mod(a, b); @rem(a, b);\nstd.math.sqrt(x); std.math.pow(f64, x, y);" },
    ] },
    { title: "Slices and lists", entries: [
      { title: "Allocate", code: "const v = try allocator.alloc(i64, n);\n@memset(v, 0);\nvar list = std.ArrayList(i64).init(allocator);\ntry list.append(x);\nlist.items.len; list.items[0];" },
      { title: "Loop", code: "for (v, 0..) |x, i| { _ = x; _ = i; }\nvar i: usize = 0;\nwhile (i < n) : (i += 1) { }" },
      { title: "Sort", code: "std.mem.sort(i64, v, {}, std.sort.asc(i64));\nstd.mem.sort(i64, v, {}, std.sort.desc(i64));" },
      { title: "Map", code: "var m = std.AutoHashMap(i64, i64).init(allocator);\ntry m.put(k, v);\nm.get(k);    // ?i64\nm.contains(k);", note: "Use std.StringHashMap for string keys." },
    ] },
  ],
};
SHEETS.brainfuck = {
  name: "Brainfuck",
  sections: [
    { title: "Commands", entries: [
      { title: "The eight commands", code: "> <    move the pointer right / left\n+ -    add / subtract 1 (cells are 8-bit and wrap)\n.      print the cell as a byte\n,      read a byte (0 at the end of input)\n[ ]    repeat while the cell is not 0", note: "Everything else is a comment. The tape is 1 MiB on each side of the start." },
      { title: "Clear a cell", code: "[-]" },
      { title: "Move a value right", code: "[->+<]", note: "Adds the current cell to the next one and empties it." },
      { title: "Echo the input", code: ",[.,]" },
    ] },
  ],
};

/** Which sheet opens first for a judge language. */
export const SHEET_OF: Record<string, string> = {
  CPP: "cpp", CPP20: "cpp", C: "c", JAVA: "java", PYTHON: "python", PYPY: "python", JAVASCRIPT: "javascript",
  GO: "go", RUST: "rust", KOTLIN: "kotlin", CSHARP: "csharp", RUBY: "ruby", PHP: "php", ZIG: "zig", BRAINFUCK: "brainfuck",
};
