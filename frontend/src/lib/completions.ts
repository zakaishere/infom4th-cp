import { snippetCompletion, type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

/**
 * Editor suggestions, computed entirely in the browser. They cover syntax and library names only:
 * remembering how code is written is fair in a contest, but ready-made algorithms would not be.
 */
type Table = { globals: Completion[]; members: Completion[] };

const list = (type: string, names: string, detail?: string): Completion[] =>
  names.split(/\s+/).filter(Boolean).map((label) => ({ label, type, detail }));
const snippet = (label: string, detail: string, template: string) =>
  snippetCompletion(template, { label, detail, type: "keyword", boost: 2 });

const CPP_LOOPS = [
  snippet("for", "counting loop", "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}"),
  snippet("forr", "range loop", "for (auto &${x} : ${v}) {\n\t${}\n}"),
  snippet("while", "loop", "while (${condition}) {\n\t${}\n}"),
  snippet("if", "condition", "if (${condition}) {\n\t${}\n}"),
];
const CPP_IO = snippet("fastio", "faster cin and cout", "ios::sync_with_stdio(false);\ncin.tie(nullptr);\n");
const CPP_MAIN = snippet("main", "main function", "int main() {\n\t${}\n\treturn 0;\n}");

const C_LIKE_KEYWORDS = "int long short char float double void unsigned signed const static struct enum return break continue switch case default sizeof typedef";

const TABLES: Record<string, Table> = {
  cpp: {
    globals: [
      ...CPP_LOOPS, CPP_IO, CPP_MAIN,
      ...list("keyword", C_LIKE_KEYWORDS + " bool true false auto class public private template typename using namespace new delete nullptr else do"),
      ...list("class", "vector string map set unordered_map unordered_set multiset multimap pair tuple queue deque stack priority_queue array bitset list", "container"),
      ...list("function", "sort stable_sort reverse unique lower_bound upper_bound binary_search next_permutation prev_permutation max_element min_element accumulate fill swap max min abs gcd lcm iota count find rotate shuffle partial_sort nth_element", "algorithm"),
      ...list("function", "sqrt pow floor ceil round log log2 log10 exp sin cos tan hypot", "cmath"),
      ...list("function", "make_pair make_tuple to_string stoi stoll stod getline tie greater less memset", "utility"),
      ...list("variable", "cin cout cerr endl", "iostream"),
      ...list("constant", "INT_MAX INT_MIN LLONG_MAX LLONG_MIN UINT_MAX", "limit"),
    ],
    members: list("method", "push_back pop_back emplace_back push_front pop_front push pop top front back size empty clear begin end rbegin rend insert erase find count resize assign reserve substr first second length append at lower_bound upper_bound"),
  },
  c: {
    globals: [
      snippet("for", "counting loop", "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}"),
      snippet("while", "loop", "while (${condition}) {\n\t${}\n}"),
      snippet("if", "condition", "if (${condition}) {\n\t${}\n}"),
      snippet("main", "main function", "int main(void) {\n\t${}\n\treturn 0;\n}"),
      ...list("keyword", C_LIKE_KEYWORDS + " else do"),
      ...list("function", "printf scanf puts putchar getchar fgets fprintf sscanf sprintf", "stdio"),
      ...list("function", "malloc calloc realloc free qsort bsearch abs labs atoi atol", "stdlib"),
      ...list("function", "strlen strcmp strncmp strcpy strncpy strcat strchr strstr memset memcpy", "string"),
      ...list("function", "sqrt pow floor ceil fabs log log2 exp", "math"),
      ...list("constant", "INT_MAX INT_MIN LLONG_MAX LLONG_MIN NULL EOF stdin stdout stderr", "constant"),
    ],
    members: [],
  },
  java: {
    globals: [
      snippet("for", "counting loop", "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}"),
      snippet("fore", "for-each loop", "for (${int} ${x} : ${items}) {\n\t${}\n}"),
      snippet("while", "loop", "while (${condition}) {\n\t${}\n}"),
      snippet("if", "condition", "if (${condition}) {\n\t${}\n}"),
      snippet("sout", "print a line", "System.out.println(${});"),
      snippet("fastin", "faster input", "BufferedReader in = new BufferedReader(new InputStreamReader(System.in));\nStringTokenizer st = new StringTokenizer(in.readLine());\n"),
      ...list("keyword", "public private protected static final class interface extends implements new return void int long double float char boolean byte short true false null if else switch case default break continue try catch throw throws import package this super"),
      ...list("class", "String StringBuilder Integer Long Double Character Boolean Math Arrays Collections List ArrayList LinkedList Map HashMap TreeMap Set HashSet TreeSet Queue Deque ArrayDeque PriorityQueue Stack Scanner BufferedReader InputStreamReader PrintWriter StringTokenizer Comparator System", "java"),
    ],
    members: list("method", "add addAll get set remove size isEmpty contains containsKey containsValue put getOrDefault keySet values entrySet getKey getValue push pop peek poll offer addFirst addLast pollFirst pollLast peekFirst peekLast first last floor ceiling lower higher length charAt substring indexOf split trim equals compareTo toCharArray toString append reverse insert sort fill asList stream println print printf readLine nextToken hasMoreTokens nextInt nextLong nextDouble next nextLine hasNext parseInt parseLong valueOf max min abs pow sqrt floor ceil out in"),
  },
  python: {
    globals: [
      snippet("for", "counting loop", "for ${i} in range(${n}):\n\t${}"),
      snippet("if", "condition", "if ${condition}:\n\t${}"),
      snippet("while", "loop", "while ${condition}:\n\t${}"),
      snippet("def", "function", "def ${name}(${args}):\n\t${}"),
      snippet("readints", "read a line of numbers", "${values} = list(map(int, input().split()))"),
      snippet("fastin", "read all input at once", "import sys\ndata = sys.stdin.read().split()\n"),
      ...list("keyword", "def class return if elif else for while break continue pass import from as in not and or is None True False lambda try except finally with yield global nonlocal"),
      ...list("function", "print input int float str bool list dict set tuple range len sum min max abs sorted reversed enumerate zip map filter round pow divmod ord chr any all bin hex isinstance", "builtin"),
      ...list("class", "sys math collections heapq bisect itertools functools deque defaultdict Counter", "module"),
    ],
    members: list("method", "append extend insert pop remove sort reverse index count clear copy keys values items get setdefault update add discard split join strip lstrip rstrip replace find upper lower startswith endswith isdigit isalpha format appendleft popleft stdin stdout read readline readlines write sqrt floor ceil gcd lcm isqrt inf pi heappush heappop heapify bisect_left bisect_right permutations combinations product accumulate most_common"),
  },
  javascript: {
    globals: [
      snippet("for", "counting loop", "for (let ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}"),
      snippet("forof", "for-of loop", "for (const ${x} of ${items}) {\n\t${}\n}"),
      snippet("if", "condition", "if (${condition}) {\n\t${}\n}"),
      snippet("readall", "read all input", "const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/);\n"),
      ...list("keyword", "const let var function return if else while break continue switch case default new class this true false null undefined typeof of in try catch throw require"),
      ...list("class", "Math Number String Array Object Map Set BigInt JSON console parseInt parseFloat", "global"),
    ],
    members: list("method", "push pop shift unshift slice splice sort reverse map filter reduce forEach join indexOf includes find concat fill length size add has get set delete keys values entries split trim substring charCodeAt toString toFixed floor ceil round abs min max sqrt pow log"),
  },
  go: {
    globals: [
      snippet("for", "counting loop", "for ${i} := 0; ${i} < ${n}; ${i}++ {\n\t${}\n}"),
      snippet("forr", "range loop", "for ${i}, ${v} := range ${items} {\n\t${}\n}"),
      snippet("if", "condition", "if ${condition} {\n\t${}\n}"),
      snippet("func", "function", "func ${name}(${args}) ${result} {\n\t${}\n}"),
      ...list("keyword", "package import func var const type struct interface map chan go defer return if else for range switch case default break continue select true false nil"),
      ...list("class", "int int64 float64 string bool byte rune error", "type"),
      ...list("function", "len cap make append copy delete new panic", "builtin"),
      ...list("variable", "fmt os bufio sort strings strconv math", "package"),
    ],
    members: list("method", "Println Printf Print Scan Scanln Scanf Sprintf Sprint Fscan Fprintln Fprintf NewReader NewWriter NewScanner Flush ReadString Stdin Stdout Ints Strings Slice Sqrt Pow Abs Floor Ceil Max Min Atoi Itoa Split Fields Join Contains TrimSpace"),
  },
  rust: {
    globals: [
      snippet("for", "range loop", "for ${i} in 0..${n} {\n\t${}\n}"),
      snippet("if", "condition", "if ${condition} {\n\t${}\n}"),
      snippet("fn", "function", "fn ${name}(${args}) {\n\t${}\n}"),
      ...list("keyword", "fn let mut const static struct enum impl trait pub use mod match if else for while loop in break continue return self Self true false as ref move"),
      ...list("class", "i32 i64 u32 u64 usize f64 bool char str String Vec HashMap HashSet BTreeMap BTreeSet VecDeque BinaryHeap Option Some None Result Ok Err", "type"),
      ...list("function", "println! print! eprintln! format! vec! assert!", "macro"),
    ],
    members: list("method", "push pop len is_empty clear iter iter_mut into_iter map filter sum collect sort sort_unstable reverse contains insert remove get get_mut entry or_insert unwrap parse trim split_whitespace lines chars to_string read_to_string read_line push_str abs min max pow sqrt"),
  },
  kotlin: {
    globals: [
      snippet("for", "range loop", "for (${i} in 0 until ${n}) {\n\t${}\n}"),
      snippet("if", "condition", "if (${condition}) {\n\t${}\n}"),
      snippet("fun", "function", "fun ${name}(${args}) {\n\t${}\n}"),
      ...list("keyword", "fun val var class object if else when for while in until downTo step return break continue null true false is as"),
      ...list("class", "Int Long Double Boolean Char String List MutableList Map MutableMap Set MutableSet Array IntArray LongArray ArrayDeque PriorityQueue", "type"),
      ...list("function", "println print readLine readln mutableListOf listOf mutableMapOf mapOf mutableSetOf setOf arrayOf intArrayOf maxOf minOf", "function"),
    ],
    members: list("method", "add remove size isEmpty contains get put getOrDefault keys values sort sorted sortedBy sortDescending reverse reversed map filter sum sumOf maxOrNull minOrNull first last joinToString split trim toInt toLong toDouble toString length forEach indices bufferedReader readText"),
  },
  csharp: {
    globals: [
      snippet("for", "counting loop", "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}"),
      snippet("foreach", "for-each loop", "foreach (var ${x} in ${items}) {\n\t${}\n}"),
      snippet("if", "condition", "if (${condition}) {\n\t${}\n}"),
      snippet("cw", "print a line", "Console.WriteLine(${});"),
      ...list("keyword", "using namespace class public private static void int long double float char bool string var new return if else while break continue switch case default true false null"),
      ...list("class", "Console Math Array List Dictionary HashSet Queue Stack SortedDictionary SortedSet StringBuilder Convert String Int32 Int64", "system"),
    ],
    members: list("method", "WriteLine Write ReadLine ReadToEnd In Add Remove Count Length Contains ContainsKey Clear Sort Reverse ToArray ToList Enqueue Dequeue Push Pop Peek Split Trim Substring Parse ToString Abs Max Min Sqrt Pow Floor Ceiling Sum Select Where"),
  },
  ruby: {
    globals: [
      snippet("times", "repeat n times", "${n}.times do |${i}|\n\t${}\nend"),
      snippet("if", "condition", "if ${condition}\n\t${}\nend"),
      snippet("def", "method", "def ${name}(${args})\n\t${}\nend"),
      ...list("keyword", "def end if elsif else unless while until for in do return break next true false nil and or not class module require"),
      ...list("function", "puts print p gets", "kernel"),
      ...list("class", "STDIN Array Hash String Integer Float Math", "class"),
    ],
    members: list("method", "read split map sum to_i to_f to_s chomp strip length size push pop shift unshift sort sort_by reverse each each_with_index select reject include? first last join max min keys values times"),
  },
  php: {
    globals: [
      snippet("for", "counting loop", "for ($${i} = 0; $${i} < $${n}; $${i}++) {\n\t${}\n}"),
      snippet("foreach", "for-each loop", "foreach ($${items} as $${x}) {\n\t${}\n}"),
      snippet("if", "condition", "if (${condition}) {\n\t${}\n}"),
      ...list("keyword", "function return if else elseif while for foreach as break continue echo true false null"),
      ...list("function", "fgets fscanf trim explode implode array_map array_sum array_slice count sort rsort usort strlen substr str_repeat intval floatval max min abs sqrt pow floor ceil preg_split stream_get_contents printf", "php"),
      ...list("constant", "STDIN STDOUT PHP_EOL PHP_INT_MAX", "constant"),
    ],
    members: [],
  },
};
const TABLE_OF: Record<string, string> = {
  CPP: "cpp", CPP20: "cpp", C: "c", JAVA: "java", PYTHON: "python", PYPY: "python", JAVASCRIPT: "javascript",
  GO: "go", RUST: "rust", KOTLIN: "kotlin", CSHARP: "csharp", RUBY: "ruby", PHP: "php",
};

const MAX_SCAN = 100_000, MAX_NAMES = 300;

/** Names already in the program, so a contestant's own variables are suggested too. */
function namesInDocument(context: CompletionContext, table: Table, current: string): Completion[] {
  const known = new Set(table.globals.map((c) => c.label));
  const seen = new Set<string>();
  const text = context.state.sliceDoc(0, Math.min(context.state.doc.length, MAX_SCAN));
  for (const match of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (seen.size >= MAX_NAMES) break;
    if (match[0].length > 1 && match[0] !== current && !known.has(match[0])) seen.add(match[0]);
  }
  return [...seen].map((label) => ({ label, type: "variable" }));
}

function inCommentOrString(context: CompletionContext) {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent)
    if (/comment|string/i.test(node.name)) return true;
  return false;
}

export function completionsFor(language?: string): CompletionSource {
  const table = language ? TABLES[TABLE_OF[language]] : undefined;
  return (context) => {
    if (!table || inCommentOrString(context)) return null;
    const word = context.matchBefore(/[\w$]*/);
    const from = word?.from ?? context.pos, current = word?.text ?? "";
    if (/^\d/.test(current)) return null;
    const before = context.state.sliceDoc(Math.max(0, from - 2), from);
    const member = before.endsWith(".") || before === "->";
    // A digit before the dot is a decimal number, not a member.
    if (member && /\d\.$/.test(before)) return null;
    if (!context.explicit && !member && current.length < 2) return null;
    const options = member ? table.members : [...table.globals, ...namesInDocument(context, table, current)];
    return options.length ? { from, options, validFor: /^[\w$]*$/ } : null;
  };
}
