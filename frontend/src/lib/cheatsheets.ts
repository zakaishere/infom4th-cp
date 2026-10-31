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
};

/** Which sheet opens first for a judge language. */
export const SHEET_OF: Record<string, string> = { CPP: "cpp", CPP20: "cpp", C: "cpp", JAVA: "java", KOTLIN: "java", PYTHON: "python", PYPY: "python" };
