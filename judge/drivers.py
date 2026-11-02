"""Function-mode problems: the contestant writes one function and a generated driver does the I/O.

A problem's signature names the function, its typed parameters and its return type. Each test
input holds one JSON value per parameter (one per line); the expected output holds the return
value as JSON. The driver parses the input, calls the function and prints the result as JSON
after a per-job marker line, so anything the contestant prints before it is ignored. Results
are compared as values (doubles within 1e-5), not as text.

Types are a base (int, long, double, bool, string) followed by up to two "[]".
The frontend's starter code (frontend/src/lib/functionMode.ts) follows the same conventions.
"""
from __future__ import annotations
import json
import math
import re

BASES = ("int", "long", "double", "bool", "string")
MAX_DIMS = 2
MAX_PARAMS = 10
# Every language but Brainfuck, which has no functions.
FUNCTION_LANGUAGES = {"CPP", "CPP20", "C", "JAVA", "PYTHON", "PYPY", "JAVASCRIPT", "GO", "RUST",
                      "KOTLIN", "CSHARP", "RUBY", "PHP", "ZIG"}
NAME = re.compile(r"[a-z][a-zA-Z0-9]{0,39}")


def parse_type(text: str) -> tuple[str, int]:
    base = text.removesuffix("[]").removesuffix("[]")
    dims = (len(text) - len(base)) // 2
    if base not in BASES or text != base + "[]" * dims:
        raise ValueError("Unsupported type: " + text)
    return base, dims


def snake(name: str) -> str:
    """twoSum -> two_sum, for Rust and Ruby (same rule as the frontend)."""
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower()


def validate(signature: dict) -> tuple[str, list[tuple[str, int]], tuple[str, int]]:
    """Returns (function name, parameter types, return type); raises ValueError when invalid.
    The backend checks names against every language's keywords before a problem is saved."""
    name = signature.get("functionName")
    params = signature.get("params")
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise ValueError("Invalid function name")
    if not isinstance(params, list) or not 1 <= len(params) <= MAX_PARAMS:
        raise ValueError("A function takes 1-%d parameters" % MAX_PARAMS)
    seen = {snake(name)}
    types = []
    for param in params:
        if not isinstance(param, dict) or not isinstance(param.get("name"), str) or not NAME.fullmatch(param["name"]):
            raise ValueError("Invalid parameter name")
        if snake(param["name"]) in seen:
            raise ValueError("Duplicate name: " + param["name"])
        seen.add(snake(param["name"]))
        types.append(parse_type(str(param.get("type"))))
    return name, types, parse_type(str(signature.get("returnType")))


def same(expected, actual, base: str, dims: int) -> bool:
    if dims:
        return (isinstance(actual, list) and isinstance(expected, list) and len(actual) == len(expected)
                and all(same(e, a, base, dims - 1) for e, a in zip(expected, actual)))
    if base in ("int", "long"):
        return type(actual) is int and actual == expected
    if base == "double":
        return (type(actual) in (int, float) and type(expected) in (int, float) and math.isfinite(actual)
                and math.isclose(actual, expected, rel_tol=1e-5, abs_tol=1e-5))
    if base == "bool":
        return type(actual) is bool and actual == expected
    return type(actual) is str and actual == expected


def result_matches(output: bytes, expected: str, signature: dict, marker: str) -> bool:
    """True when the value printed after the last marker equals the expected return value."""
    try:
        text = output.decode("utf-8")
        position = text.rfind("\n" + marker + "\n")
        if position < 0:
            return False
        actual = json.loads(text[position + len(marker) + 2:])
        wanted = json.loads(expected)
    except (UnicodeDecodeError, ValueError):
        return False
    return same(wanted, actual, *parse_type(signature["returnType"]))


def wrap(language: str, source: str, signature: dict, marker: str) -> str:
    """The contestant's source with the hidden driver around it, ready to compile."""
    name, params, returns = validate(signature)
    if language not in FUNCTION_LANGUAGES:
        raise ValueError(language + " does not support function problems")
    build = GENERATORS["CPP" if language == "CPP20" else "PYTHON" if language == "PYPY" else language]
    return build(source, name, params, returns, json.dumps(marker))


# ---------------------------------------------------------------------------------------------
# C++: overloaded readers and writers; vectors by reference, like LeetCode.

CPP_TYPES = {"int": "int", "long": "long long", "double": "double", "bool": "bool", "string": "std::string"}
CPP_RUNTIME = r"""
namespace __cp {
std::string in; size_t at = 0;
[[noreturn]] void bad() { std::fputs("invalid test input\n", stderr); std::exit(3); }
void ws() { while (at < in.size() && std::isspace((unsigned char)in[at])) at++; }
bool peek(char c) { ws(); return at < in.size() && in[at] == c; }
void expect(char c) { if (!peek(c)) bad(); at++; }
std::string token() {
    ws(); size_t start = at;
    while (at < in.size() && (std::isalnum((unsigned char)in[at]) || in[at] == '-' || in[at] == '+' || in[at] == '.')) at++;
    if (start == at) bad();
    return in.substr(start, at - start);
}
long long integer() { std::string t = token(); char* end; errno = 0; long long v = std::strtoll(t.c_str(), &end, 10); if (*end || errno) bad(); return v; }
void read(int& v) { long long x = integer(); if (x < INT_MIN || x > INT_MAX) bad(); v = (int)x; }
void read(long long& v) { v = integer(); }
void read(double& v) { std::string t = token(); char* end; v = std::strtod(t.c_str(), &end); if (*end) bad(); }
void read(bool& v) { std::string t = token(); if (t == "true") v = true; else if (t == "false") v = false; else bad(); }
unsigned hex4() {
    if (at + 4 > in.size()) bad();
    unsigned v = 0;
    for (int i = 0; i < 4; i++) { char c = in[at++]; if (!std::isxdigit((unsigned char)c)) bad(); v = v * 16 + (std::isdigit((unsigned char)c) ? c - '0' : std::tolower(c) - 'a' + 10); }
    return v;
}
void utf8(std::string& s, unsigned c) {
    if (c < 0x80) s += (char)c;
    else if (c < 0x800) { s += (char)(0xC0 | c >> 6); s += (char)(0x80 | (c & 0x3F)); }
    else if (c < 0x10000) { s += (char)(0xE0 | c >> 12); s += (char)(0x80 | (c >> 6 & 0x3F)); s += (char)(0x80 | (c & 0x3F)); }
    else { s += (char)(0xF0 | c >> 18); s += (char)(0x80 | (c >> 12 & 0x3F)); s += (char)(0x80 | (c >> 6 & 0x3F)); s += (char)(0x80 | (c & 0x3F)); }
}
void read(std::string& v) {
    expect('"'); v.clear();
    for (;;) {
        if (at >= in.size()) bad();
        char c = in[at++];
        if (c == '"') return;
        if (c != '\\') { v += c; continue; }
        if (at >= in.size()) bad();
        switch (c = in[at++]) {
            case 'n': v += '\n'; break; case 't': v += '\t'; break; case 'r': v += '\r'; break;
            case 'b': v += '\b'; break; case 'f': v += '\f'; break;
            case 'u': {
                unsigned u = hex4();
                if (u >= 0xD800 && u < 0xDC00 && at + 1 < in.size() && in[at] == '\\' && in[at + 1] == 'u') { at += 2; u = 0x10000 + ((u - 0xD800) << 10) + (hex4() - 0xDC00); }
                utf8(v, u); break;
            }
            default: v += c;
        }
    }
}
template <class T> void read(std::vector<T>& v) {
    expect('['); v.clear();
    if (peek(']')) { at++; return; }
    for (;;) { T x{}; read(x); v.push_back(std::move(x)); if (peek(',')) { at++; continue; } expect(']'); return; }
}
std::string out;
void write(int v) { out += std::to_string(v); }
void write(long long v) { out += std::to_string(v); }
void write(double v) { char b[64]; std::snprintf(b, sizeof b, "%.17g", v); out += b; }
void write(bool v) { out += v ? "true" : "false"; }
void write(const std::string& s) {
    out += '"';
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') { out += '\\'; out += (char)c; }
        else if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); out += b; }
        else out += (char)c;
    }
    out += '"';
}
template <class T> void write(const std::vector<T>& v) {
    out += '[';
    for (size_t i = 0; i < v.size(); i++) {
        if (i) out += ',';
        if constexpr (std::is_same_v<T, bool>) write((bool)v[i]); else write(v[i]);
    }
    out += ']';
}
}
"""


def cpp_type(base, dims):
    return "std::vector<" * dims + CPP_TYPES[base] + ">" * dims


def generate_cpp(source, name, params, returns, marker):
    lines = ["int main() {", "    { std::ostringstream s; s << std::cin.rdbuf(); __cp::in = s.str(); }"]
    for i, (base, dims) in enumerate(params):
        lines.append(f"    {cpp_type(base, dims)} __p{i}{{}}; __cp::read(__p{i});")
    args = ", ".join(f"__p{i}" for i in range(len(params)))
    lines += [f"    {cpp_type(*returns)} __r = Solution().{name}({args});",
              "    __cp::write(__r);",
              f"    std::cout << std::flush; std::cout << \"\\n\" << {marker} << \"\\n\" << __cp::out << \"\\n\" << std::flush;",
              "    return 0;", "}"]
    # #line keeps compiler messages on the contestant's own line numbers.
    return ("#include <bits/stdc++.h>\nusing namespace std;\n#line 1\n" + source + "\n#line 100000 \"driver\"\n"
            + CPP_RUNTIME + "\n".join(lines) + "\n")


# ---------------------------------------------------------------------------------------------
# C: arrays come with their sizes, like LeetCode (int* nums, int numsSize; int** returnColumnSizes).

C_TYPES = {"int": "int", "long": "long long", "double": "double", "bool": "bool", "string": "char*"}
C_RUNTIME = r"""
static char *__in; static size_t __at, __len;
static void __bad(void) { fputs("invalid test input\n", stderr); exit(3); }
static void __ws(void) { while (__at < __len && isspace((unsigned char)__in[__at])) __at++; }
static int __peek(char c) { __ws(); return __at < __len && __in[__at] == c; }
static void __expect(char c) { if (!__peek(c)) __bad(); __at++; }
static long long __integer(void) {
    __ws(); char *end; errno = 0;
    long long v = strtoll(__in + __at, &end, 10);
    if (end == __in + __at || errno) __bad();
    __at = end - __in; return v;
}
static int __r_int(void) { long long v = __integer(); if (v < INT_MIN || v > INT_MAX) __bad(); return (int)v; }
static long long __r_long(void) { return __integer(); }
static double __r_double(void) { __ws(); char *end; double v = strtod(__in + __at, &end); if (end == __in + __at) __bad(); __at = end - __in; return v; }
static bool __r_bool(void) {
    __ws();
    if (!strncmp(__in + __at, "true", 4)) { __at += 4; return true; }
    if (!strncmp(__in + __at, "false", 5)) { __at += 5; return false; }
    __bad(); return false;
}
static unsigned __hex4(void) {
    if (__at + 4 > __len) __bad();
    unsigned v = 0;
    for (int i = 0; i < 4; i++) { char c = __in[__at++]; if (!isxdigit((unsigned char)c)) __bad(); v = v * 16 + (isdigit((unsigned char)c) ? c - '0' : tolower(c) - 'a' + 10); }
    return v;
}
static char *__r_string(void) {
    __expect('"');
    size_t n = 0, cap = 16; char *s = malloc(cap);
    for (;;) {
        if (n + 5 > cap) s = realloc(s, cap *= 2);
        if (__at >= __len) __bad();
        char c = __in[__at++];
        if (c == '"') { s[n] = 0; return s; }
        if (c != '\\') { s[n++] = c; continue; }
        if (__at >= __len) __bad();
        c = __in[__at++];
        if (c == 'n') s[n++] = '\n'; else if (c == 't') s[n++] = '\t'; else if (c == 'r') s[n++] = '\r';
        else if (c == 'b') s[n++] = '\b'; else if (c == 'f') s[n++] = '\f';
        else if (c == 'u') {
            unsigned u = __hex4();
            if (u >= 0xD800 && u < 0xDC00 && __at + 1 < __len && __in[__at] == '\\' && __in[__at + 1] == 'u') { __at += 2; u = 0x10000 + ((u - 0xD800) << 10) + (__hex4() - 0xDC00); }
            if (u < 0x80) s[n++] = (char)u;
            else if (u < 0x800) { s[n++] = (char)(0xC0 | u >> 6); s[n++] = (char)(0x80 | (u & 0x3F)); }
            else if (u < 0x10000) { s[n++] = (char)(0xE0 | u >> 12); s[n++] = (char)(0x80 | (u >> 6 & 0x3F)); s[n++] = (char)(0x80 | (u & 0x3F)); }
            else { s[n++] = (char)(0xF0 | u >> 18); s[n++] = (char)(0x80 | (u >> 12 & 0x3F)); s[n++] = (char)(0x80 | (u >> 6 & 0x3F)); s[n++] = (char)(0x80 | (u & 0x3F)); }
        } else s[n++] = c;
    }
}
static void __w_int(int v) { printf("%d", v); }
static void __w_long(long long v) { printf("%lld", v); }
static void __w_double(double v) { printf("%.17g", v); }
static void __w_bool(bool v) { fputs(v ? "true" : "false", stdout); }
static void __w_string(const char *s) {
    putchar('"');
    for (; s && *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') { putchar('\\'); putchar(c); }
        else if (c < 0x20) printf("\\u%04x", c);
        else putchar(c);
    }
    putchar('"');
}
#define __ARRAYS(T, NAME) \
static T *__r_##NAME##_1(int *size) { \
    __expect('['); int n = 0, cap = 4; T *v = malloc(cap * sizeof(T)); \
    if (__peek(']')) { __at++; *size = 0; return v; } \
    for (;;) { \
        if (n == cap) v = realloc(v, (cap *= 2) * sizeof(T)); \
        v[n++] = __r_##NAME(); \
        if (__peek(',')) { __at++; continue; } \
        __expect(']'); *size = n; return v; \
    } \
} \
static T **__r_##NAME##_2(int *size, int **columns) { \
    __expect('['); int n = 0, cap = 4; T **v = malloc(cap * sizeof(T *)); int *c = malloc(cap * sizeof(int)); \
    *columns = c; \
    if (__peek(']')) { __at++; *size = 0; return v; } \
    for (;;) { \
        if (n == cap) { cap *= 2; v = realloc(v, cap * sizeof(T *)); c = realloc(c, cap * sizeof(int)); *columns = c; } \
        v[n] = __r_##NAME##_1(&c[n]); n++; \
        if (__peek(',')) { __at++; continue; } \
        __expect(']'); *size = n; return v; \
    } \
} \
static void __w_##NAME##_1(T *v, int n) { putchar('['); for (int i = 0; i < n; i++) { if (i) putchar(','); __w_##NAME(v[i]); } putchar(']'); } \
static void __w_##NAME##_2(T **v, int n, int *columns) { putchar('['); for (int i = 0; i < n; i++) { if (i) putchar(','); __w_##NAME##_1(v[i], columns ? columns[i] : 0); } putchar(']'); }
__ARRAYS(int, int)
__ARRAYS(long long, long)
__ARRAYS(double, double)
__ARRAYS(bool, bool)
__ARRAYS(char *, string)
"""


def generate_c(source, name, params, returns, marker):
    lines = ["int main(void) {",
             "    size_t cap = 1 << 16; __in = malloc(cap);",
             "    for (size_t got; (got = fread(__in + __len, 1, cap - __len - 1, stdin)) > 0;) { __len += got; if (cap - __len < 2) __in = realloc(__in, cap *= 2); }",
             "    __in[__len] = 0;"]
    args = []
    for i, (base, dims) in enumerate(params):
        t = C_TYPES[base] + "*" * dims
        if dims == 0:
            lines.append(f"    {t} __p{i} = __r_{base}();")
            args.append(f"__p{i}")
        elif dims == 1:
            lines.append(f"    int __s{i}; {t} __p{i} = __r_{base}_1(&__s{i});")
            args += [f"__p{i}", f"__s{i}"]
        else:
            lines.append(f"    int __s{i}; int *__c{i}; {t} __p{i} = __r_{base}_2(&__s{i}, &__c{i});")
            args += [f"__p{i}", f"__s{i}", f"__c{i}"]
    base, dims = returns
    t = C_TYPES[base] + "*" * dims
    if dims == 0:
        call, write = f"{t} __r = {name}({', '.join(args)});", f"__w_{base}(__r);"
    elif dims == 1:
        call = f"int __rs = 0; {t} __r = {name}({', '.join(args + ['&__rs'])});"
        write = f"__w_{base}_1(__r, __rs);"
    else:
        call = f"int __rs = 0; int *__rc = NULL; {t} __r = {name}({', '.join(args + ['&__rs', '&__rc'])});"
        write = f"__w_{base}_2(__r, __rs, __rc);"
    lines += ["    " + call, "    fflush(stdout);", f"    printf(\"\\n%s\\n\", {marker});",
              "    " + write, "    putchar('\\n');", "    return 0;", "}"]
    prefix = "".join(f"#include <{h}.h>\n" for h in ("stdio", "stdlib", "string", "stdbool", "math", "ctype", "errno", "limits"))
    return prefix + "#line 1\n" + source + "\n#line 100000 \"driver\"\n" + C_RUNTIME + "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------------------------
# Java: class Solution with an instance method; the driver is class Main.

JAVA_TYPES = {"int": "int", "long": "long", "double": "double", "bool": "boolean", "string": "String"}
JAVA_SCALAR = {"int": "i()", "long": "l()", "double": "d()", "bool": "b()", "string": "s()"}
JAVA_PRIMITIVE_ARRAY = {"int": "ia()", "long": "la()", "double": "da()", "bool": "ba()"}
JAVA_RUNTIME = r"""
class Main {
    static String in; static int at;
    static RuntimeException bad() { System.err.println("invalid test input"); System.exit(3); return new RuntimeException(); }
    static void ws() { while (at < in.length() && Character.isWhitespace(in.charAt(at))) at++; }
    static boolean peek(char c) { ws(); return at < in.length() && in.charAt(at) == c; }
    static void expect(char c) { if (!peek(c)) throw bad(); at++; }
    static String token() {
        ws(); int start = at;
        while (at < in.length() && (Character.isLetterOrDigit(in.charAt(at)) || "+-.".indexOf(in.charAt(at)) >= 0)) at++;
        if (start == at) throw bad();
        return in.substring(start, at);
    }
    static int i() { try { return Integer.parseInt(token()); } catch (NumberFormatException e) { throw bad(); } }
    static long l() { try { return Long.parseLong(token()); } catch (NumberFormatException e) { throw bad(); } }
    static double d() { try { return Double.parseDouble(token()); } catch (NumberFormatException e) { throw bad(); } }
    static boolean b() { String t = token(); if (t.equals("true")) return true; if (t.equals("false")) return false; throw bad(); }
    static String s() {
        expect('"'); StringBuilder v = new StringBuilder();
        while (true) {
            if (at >= in.length()) throw bad();
            char c = in.charAt(at++);
            if (c == '"') return v.toString();
            if (c != '\\') { v.append(c); continue; }
            if (at >= in.length()) throw bad();
            c = in.charAt(at++);
            switch (c) {
                case 'n': v.append('\n'); break; case 't': v.append('\t'); break; case 'r': v.append('\r'); break;
                case 'b': v.append('\b'); break; case 'f': v.append('\f'); break;
                case 'u':
                    if (at + 4 > in.length()) throw bad();
                    try { v.append((char) Integer.parseInt(in.substring(at, at + 4), 16)); } catch (NumberFormatException e) { throw bad(); }
                    at += 4; break;
                default: v.append(c);
            }
        }
    }
    static <T> java.util.ArrayList<T> list(java.util.function.Supplier<T> item) {
        expect('['); java.util.ArrayList<T> v = new java.util.ArrayList<>();
        if (peek(']')) { at++; return v; }
        while (true) { v.add(item.get()); if (peek(',')) { at++; continue; } expect(']'); return v; }
    }
    static int[] ia() { return list(Main::i).stream().mapToInt(x -> x).toArray(); }
    static long[] la() { return list(Main::l).stream().mapToLong(x -> x).toArray(); }
    static double[] da() { return list(Main::d).stream().mapToDouble(x -> x).toArray(); }
    static boolean[] ba() { java.util.ArrayList<Boolean> v = list(Main::b); boolean[] r = new boolean[v.size()]; for (int k = 0; k < r.length; k++) r[k] = v.get(k); return r; }
    static void w(StringBuilder o, Object v) {
        if (v == null) o.append("null");
        else if (v instanceof String) {
            String s = (String) v; o.append('"');
            for (int k = 0; k < s.length(); k++) {
                char c = s.charAt(k);
                if (c == '"' || c == '\\') o.append('\\').append(c);
                else if (c < 0x20) o.append(String.format("\\u%04x", (int) c));
                else o.append(c);
            }
            o.append('"');
        }
        else if (v instanceof int[]) { int[] a = (int[]) v; o.append('['); for (int k = 0; k < a.length; k++) { if (k > 0) o.append(','); o.append(a[k]); } o.append(']'); }
        else if (v instanceof long[]) { long[] a = (long[]) v; o.append('['); for (int k = 0; k < a.length; k++) { if (k > 0) o.append(','); o.append(a[k]); } o.append(']'); }
        else if (v instanceof double[]) { double[] a = (double[]) v; o.append('['); for (int k = 0; k < a.length; k++) { if (k > 0) o.append(','); o.append(a[k]); } o.append(']'); }
        else if (v instanceof boolean[]) { boolean[] a = (boolean[]) v; o.append('['); for (int k = 0; k < a.length; k++) { if (k > 0) o.append(','); o.append(a[k]); } o.append(']'); }
        else if (v instanceof Object[]) { Object[] a = (Object[]) v; o.append('['); for (int k = 0; k < a.length; k++) { if (k > 0) o.append(','); w(o, a[k]); } o.append(']'); }
        else o.append(v);
    }
"""


def java_type(base, dims):
    return JAVA_TYPES[base] + "[]" * dims


def java_read(base, dims):
    if dims == 0:
        return JAVA_SCALAR[base]
    if dims == 1 and base in JAVA_PRIMITIVE_ARRAY:
        return JAVA_PRIMITIVE_ARRAY[base]
    return f"list(() -> {java_read(base, dims - 1)}).toArray(new {JAVA_TYPES[base]}[0]{'[]' * (dims - 1)})"


def generate_java(source, name, params, returns, marker):
    lines = ["    public static void main(String[] args) throws Exception {",
             "        in = new String(System.in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);"]
    for i, (base, dims) in enumerate(params):
        lines.append(f"        {java_type(base, dims)} p{i} = {java_read(base, dims)};")
    args = ", ".join(f"p{i}" for i in range(len(params)))
    lines += [f"        {java_type(*returns)} r = new Solution().{name}({args});",
              "        StringBuilder o = new StringBuilder(); w(o, r);",
              # Bytes, not text: the sandbox locale may not be UTF-8.
              f"        System.out.flush(); System.out.write((\"\\n\" + {marker} + \"\\n\" + o + \"\\n\").getBytes(java.nio.charset.StandardCharsets.UTF_8)); System.out.flush();",
              "    }", "}"]
    # The imports share the contestant's first line, so compiler line numbers stay theirs.
    return ("import java.util.*; import java.util.function.*; import java.util.stream.*; import java.io.*; "
            + source + "\n" + JAVA_RUNTIME + "\n".join(lines) + "\n")


# ---------------------------------------------------------------------------------------------
# Python and PyPy: class Solution; the backend guarantees one JSON value per input line.

PYTHON_PRELUDE = ("from typing import *\nimport sys, math, collections, heapq, bisect, itertools, functools, string, re\n"
                  "from collections import *\nfrom functools import cache, lru_cache, reduce\n")
PYTHON_RUNTIME = r"""

def __cp_main():
    import json, sys
    def convert(value, base, dims):
        if dims:
            return [convert(item, base, dims - 1) for item in value]
        return float(value) if base == "double" else value
    def show(value, base, dims):
        if dims:
            return "[" + ",".join(show(item, base, dims - 1) for item in value) + "]"
        if base in ("int", "long"):
            return str(int(value))
        if base == "double":
            return repr(float(value))
        if base == "bool":
            return "true" if value else "false"
        return json.dumps(value)
    # Bytes, not text: the sandbox locale may not be UTF-8.
    lines = [line for line in sys.stdin.buffer.read().decode("utf-8").split("\n") if line.strip()]
    args = [convert(json.loads(line), base, dims) for line, (base, dims) in zip(lines, PARAMS)]
    if len(args) != len(PARAMS):
        sys.exit("invalid test input")
    result = Solution().NAME(*args)
    sys.stdout.flush()
    sys.stdout.buffer.write(("\n" + MARKER + "\n" + show(result, *RETURNS) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()

__cp_main()
"""


def generate_python(source, name, params, returns, marker):
    runtime = (PYTHON_RUNTIME.replace("PARAMS", repr(params)).replace("RETURNS", repr(returns))
               .replace("MARKER", marker).replace("NAME", name))
    return PYTHON_PRELUDE + source + runtime


# ---------------------------------------------------------------------------------------------
# JavaScript: a plain function, like LeetCode.

JAVASCRIPT_RUNTIME = r"""
;(() => {
  const params = PARAMS, returns = RETURNS;
  const convert = (value, [base, dims]) => dims ? value.map((item) => convert(item, [base, dims - 1])) : value;
  const show = (value, [base, dims]) => {
    if (dims) return "[" + Array.from(value, (item) => show(item, [base, dims - 1])).join(",") + "]";
    if (base === "bool") return value ? "true" : "false";
    if (base === "int" || base === "long") return typeof value === "bigint" ? value.toString() : String(Math.trunc(value));
    return JSON.stringify(value);
  };
  const lines = require("fs").readFileSync(0, "utf8").split("\n").filter((line) => line.trim());
  if (lines.length < params.length) { process.stderr.write("invalid test input\n"); process.exit(3); }
  const args = params.map((type, i) => convert(JSON.parse(lines[i]), type));
  const result = NAME(...args);
  process.stdout.write("\n" + MARKER + "\n" + show(result, returns) + "\n");
})();
"""


def generate_javascript(source, name, params, returns, marker):
    return source + "\n" + (JAVASCRIPT_RUNTIME.replace("PARAMS", json.dumps(params)).replace("RETURNS", json.dumps(returns))
                            .replace("MARKER", marker).replace("NAME", name))


# ---------------------------------------------------------------------------------------------
# Go: a plain function. The package clause and imports share the contestant's first line.

GO_TYPES = {"int": "int", "long": "int64", "double": "float64", "bool": "bool", "string": "string"}
GO_SCALAR = {"int": "int(__p.integer(32))", "long": "__p.integer(64)", "double": "__p.float()",
             "bool": "__p.boolean()", "string": "__p.str()"}
GO_RUNTIME = r"""
type __parser struct { s []byte; at int }
func __bad() { __os.Stderr.WriteString("invalid test input\n"); __os.Exit(3) }
func (p *__parser) ws() { for p.at < len(p.s) && (p.s[p.at] == ' ' || p.s[p.at] == '\n' || p.s[p.at] == '\r' || p.s[p.at] == '\t') { p.at++ } }
func (p *__parser) peek(c byte) bool { p.ws(); return p.at < len(p.s) && p.s[p.at] == c }
func (p *__parser) expect(c byte) { if !p.peek(c) { __bad() }; p.at++ }
func (p *__parser) token() string {
	p.ws(); start := p.at
	for p.at < len(p.s) {
		c := p.s[p.at]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '-' || c == '+' || c == '.') { break }
		p.at++
	}
	if start == p.at { __bad() }
	return string(p.s[start:p.at])
}
func (p *__parser) integer(bits int) int64 { v, err := __strconv.ParseInt(p.token(), 10, bits); if err != nil { __bad() }; return v }
func (p *__parser) float() float64 { v, err := __strconv.ParseFloat(p.token(), 64); if err != nil { __bad() }; return v }
func (p *__parser) boolean() bool { t := p.token(); if t == "true" { return true }; if t != "false" { __bad() }; return false }
func (p *__parser) hex4() rune {
	if p.at+4 > len(p.s) { __bad() }
	v, err := __strconv.ParseUint(string(p.s[p.at:p.at+4]), 16, 32); if err != nil { __bad() }
	p.at += 4; return rune(v)
}
func (p *__parser) str() string {
	p.expect('"'); var b []byte
	for {
		if p.at >= len(p.s) { __bad() }
		c := p.s[p.at]; p.at++
		if c == '"' { return string(b) }
		if c != '\\' { b = append(b, c); continue }
		if p.at >= len(p.s) { __bad() }
		c = p.s[p.at]; p.at++
		switch c {
		case 'n': b = append(b, '\n')
		case 't': b = append(b, '\t')
		case 'r': b = append(b, '\r')
		case 'b': b = append(b, '\b')
		case 'f': b = append(b, '\f')
		case 'u':
			u := p.hex4()
			if u >= 0xD800 && u < 0xDC00 && p.at+1 < len(p.s) && p.s[p.at] == '\\' && p.s[p.at+1] == 'u' { p.at += 2; u = 0x10000 + (u-0xD800)<<10 + (p.hex4() - 0xDC00) }
			b = append(b, string(u)...)
		default: b = append(b, c)
		}
	}
}
func __list[T any](p *__parser, item func() T) []T {
	p.expect('['); v := []T{}
	if p.peek(']') { p.at++; return v }
	for { v = append(v, item()); if p.peek(',') { p.at++; continue }; p.expect(']'); return v }
}
func __write(b []byte, v any) []byte {
	switch x := v.(type) {
	case int: return __strconv.AppendInt(b, int64(x), 10)
	case int64: return __strconv.AppendInt(b, x, 10)
	case float64: return __strconv.AppendFloat(b, x, 'g', -1, 64)
	case bool: return __strconv.AppendBool(b, x)
	case string:
		b = append(b, '"')
		for i := 0; i < len(x); i++ {
			c := x[i]
			if c == '"' || c == '\\' { b = append(b, '\\', c) } else if c < 0x20 { b = append(b, []byte("\\u00")...); b = append(b, "0123456789abcdef"[c>>4], "0123456789abcdef"[c&15]) } else { b = append(b, c) }
		}
		return append(b, '"')
	}
	value := __reflect.ValueOf(v)
	if value.Kind() != __reflect.Slice { return append(b, []byte("null")...) }
	b = append(b, '[')
	for i := 0; i < value.Len(); i++ { if i > 0 { b = append(b, ',') }; b = __write(b, value.Index(i).Interface()) }
	return append(b, ']')
}
"""


def go_type(base, dims):
    return "[]" * dims + GO_TYPES[base]


def go_read(base, dims):
    if dims == 0:
        return GO_SCALAR[base]
    inner = go_type(base, dims - 1)
    return f"__list(__p, func() {inner} {{ return {go_read(base, dims - 1)} }})"


def generate_go(source, name, params, returns, marker):
    lines = ["func main() {",
             "\tinput, err := __io.ReadAll(__os.Stdin); if err != nil { __bad() }",
             "\t__p := &__parser{s: input}"]
    for i, (base, dims) in enumerate(params):
        lines.append(f"\tvar __p{i} {go_type(base, dims)} = {go_read(base, dims)}")
    args = ", ".join(f"__p{i}" for i in range(len(params)))
    lines += [f"\tvar __r {go_type(*returns)} = {name}({args})",
              f"\tout := append([]byte(\"\\n\" + {marker} + \"\\n\"), __write(nil, __r)...)",
              "\t__os.Stdout.Write(append(out, '\\n'))", "}"]
    prefix = 'package main; import (__io "io"; __os "os"; __reflect "reflect"; __strconv "strconv"); '
    return prefix + source + "\n" + GO_RUNTIME + "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------------------------
# Rust: impl Solution with snake_case functions, like LeetCode; the driver declares the struct.

RUST_TYPES = {"int": "i32", "long": "i64", "double": "f64", "bool": "bool", "string": "String"}
RUST_RUNTIME = r"""
pub struct Solution;
#[allow(dead_code)]
mod __cp {
    pub struct P { pub s: Vec<u8>, pub at: usize }
    pub fn bad() -> ! { eprintln!("invalid test input"); std::process::exit(3) }
    impl P {
        fn ws(&mut self) { while self.at < self.s.len() && self.s[self.at].is_ascii_whitespace() { self.at += 1; } }
        pub fn peek(&mut self, c: u8) -> bool { self.ws(); self.at < self.s.len() && self.s[self.at] == c }
        pub fn expect(&mut self, c: u8) { if !self.peek(c) { bad() } self.at += 1; }
        fn token(&mut self) -> String {
            self.ws(); let start = self.at;
            while self.at < self.s.len() && (self.s[self.at].is_ascii_alphanumeric() || b"+-.".contains(&self.s[self.at])) { self.at += 1; }
            if start == self.at { bad() }
            String::from_utf8_lossy(&self.s[start..self.at]).into_owned()
        }
        fn hex4(&mut self) -> u32 {
            if self.at + 4 > self.s.len() { bad() }
            let text = String::from_utf8_lossy(&self.s[self.at..self.at + 4]).into_owned();
            self.at += 4;
            u32::from_str_radix(&text, 16).unwrap_or_else(|_| bad())
        }
    }
    pub trait Rd: Sized { fn rd(p: &mut P) -> Self; }
    impl Rd for i32 { fn rd(p: &mut P) -> Self { p.token().parse().unwrap_or_else(|_| bad()) } }
    impl Rd for i64 { fn rd(p: &mut P) -> Self { p.token().parse().unwrap_or_else(|_| bad()) } }
    impl Rd for f64 { fn rd(p: &mut P) -> Self { p.token().parse().unwrap_or_else(|_| bad()) } }
    impl Rd for bool { fn rd(p: &mut P) -> Self { match p.token().as_str() { "true" => true, "false" => false, _ => bad() } } }
    impl Rd for String {
        fn rd(p: &mut P) -> Self {
            p.expect(b'"');
            let mut v: Vec<u8> = Vec::new();
            loop {
                if p.at >= p.s.len() { bad() }
                let c = p.s[p.at]; p.at += 1;
                if c == b'"' { return String::from_utf8(v).unwrap_or_else(|_| bad()); }
                if c != b'\\' { v.push(c); continue; }
                if p.at >= p.s.len() { bad() }
                let e = p.s[p.at]; p.at += 1;
                match e {
                    b'n' => v.push(b'\n'), b't' => v.push(b'\t'), b'r' => v.push(b'\r'),
                    b'b' => v.push(8), b'f' => v.push(12),
                    b'u' => {
                        let mut u = p.hex4();
                        if (0xD800..0xDC00).contains(&u) && p.at + 1 < p.s.len() && p.s[p.at] == b'\\' && p.s[p.at + 1] == b'u' {
                            p.at += 2; u = 0x10000 + ((u - 0xD800) << 10) + (p.hex4().wrapping_sub(0xDC00));
                        }
                        let c = char::from_u32(u).unwrap_or('\u{FFFD}');
                        let mut buf = [0u8; 4];
                        v.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                    }
                    other => v.push(other),
                }
            }
        }
    }
    impl<T: Rd> Rd for Vec<T> {
        fn rd(p: &mut P) -> Self {
            p.expect(b'[');
            let mut v = Vec::new();
            if p.peek(b']') { p.at += 1; return v; }
            loop { v.push(T::rd(p)); if p.peek(b',') { p.at += 1; continue; } p.expect(b']'); return v; }
        }
    }
    pub trait Wr { fn wr(&self, o: &mut String); }
    impl Wr for i32 { fn wr(&self, o: &mut String) { o.push_str(&self.to_string()); } }
    impl Wr for i64 { fn wr(&self, o: &mut String) { o.push_str(&self.to_string()); } }
    impl Wr for f64 { fn wr(&self, o: &mut String) { o.push_str(&format!("{:?}", self)); } }
    impl Wr for bool { fn wr(&self, o: &mut String) { o.push_str(if *self { "true" } else { "false" }); } }
    impl Wr for String {
        fn wr(&self, o: &mut String) {
            o.push('"');
            for c in self.chars() {
                match c { '"' => o.push_str("\\\""), '\\' => o.push_str("\\\\"), c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)), c => o.push(c) }
            }
            o.push('"');
        }
    }
    impl<T: Wr> Wr for Vec<T> {
        fn wr(&self, o: &mut String) {
            o.push('[');
            for (i, x) in self.iter().enumerate() { if i > 0 { o.push(','); } x.wr(o); }
            o.push(']');
        }
    }
}
"""


def rust_type(base, dims):
    return "Vec<" * dims + RUST_TYPES[base] + ">" * dims


def generate_rust(source, name, params, returns, marker):
    lines = ["fn main() {", "    use std::io::{Read, Write};",
             "    let mut __s = Vec::new(); std::io::stdin().read_to_end(&mut __s).unwrap_or_else(|_| __cp::bad());",
             "    let mut __p = __cp::P { s: __s, at: 0 };"]
    for i, (base, dims) in enumerate(params):
        lines.append(f"    let __p{i}: {rust_type(base, dims)} = __cp::Rd::rd(&mut __p);")
    args = ", ".join(f"__p{i}" for i in range(len(params)))
    lines += [f"    let __r: {rust_type(*returns)} = Solution::{snake(name)}({args});",
              "    let mut __o = String::new(); __cp::Wr::wr(&__r, &mut __o);",
              "    let mut __out = std::io::stdout().lock();",
              f"    let _ = write!(__out, \"\\n{{}}\\n{{}}\\n\", {marker}, __o); let _ = __out.flush();", "}"]
    return source + "\n" + RUST_RUNTIME + "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------------------------
# Kotlin: class Solution with IntArray and friends, like LeetCode.

KOTLIN_TYPES = {"int": "Int", "long": "Long", "double": "Double", "bool": "Boolean", "string": "String"}
KOTLIN_SCALAR = {"int": "__P.i()", "long": "__P.l()", "double": "__P.d()", "bool": "__P.b()", "string": "__P.s()"}
KOTLIN_PRIMITIVE = {"int": ("IntArray", "toIntArray"), "long": ("LongArray", "toLongArray"),
                    "double": ("DoubleArray", "toDoubleArray"), "bool": ("BooleanArray", "toBooleanArray")}
KOTLIN_RUNTIME = r"""
object __P {
    var src = ""
    var at = 0
    fun bad(): Nothing { System.err.println("invalid test input"); kotlin.system.exitProcess(3) }
    fun ws() { while (at < src.length && src[at].isWhitespace()) at++ }
    fun peek(c: Char): Boolean { ws(); return at < src.length && src[at] == c }
    fun expect(c: Char) { if (!peek(c)) bad(); at++ }
    fun token(): String {
        ws(); val start = at
        while (at < src.length && (src[at].isLetterOrDigit() || src[at] == '+' || src[at] == '-' || src[at] == '.')) at++
        if (start == at) bad()
        return src.substring(start, at)
    }
    fun i(): Int = token().toIntOrNull() ?: bad()
    fun l(): Long = token().toLongOrNull() ?: bad()
    fun d(): Double = token().toDoubleOrNull() ?: bad()
    fun b(): Boolean = when (token()) { "true" -> true; "false" -> false; else -> bad() }
    fun s(): String {
        expect('"'); val v = StringBuilder()
        while (true) {
            if (at >= src.length) bad()
            var c = src[at++]
            if (c == '"') return v.toString()
            if (c != '\\') { v.append(c); continue }
            if (at >= src.length) bad()
            c = src[at++]
            when (c) {
                'n' -> v.append('\n'); 't' -> v.append('\t'); 'r' -> v.append('\r')
                'b' -> v.append('\b'); 'f' -> v.append('\u000C')
                'u' -> { if (at + 4 > src.length) bad(); v.append((src.substring(at, at + 4).toIntOrNull(16) ?: bad()).toChar()); at += 4 }
                else -> v.append(c)
            }
        }
    }
    fun <T> list(item: () -> T): MutableList<T> {
        expect('['); val v = mutableListOf<T>()
        if (peek(']')) { at++; return v }
        while (true) { v.add(item()); if (peek(',')) { at++; continue }; expect(']'); return v }
    }
    fun w(o: StringBuilder, v: Any?) {
        when (v) {
            null -> o.append("null")
            is String -> {
                o.append('"')
                for (c in v) { if (c == '"' || c == '\\') o.append('\\').append(c) else if (c.code < 0x20) o.append(String.format("\\u%04x", c.code)) else o.append(c) }
                o.append('"')
            }
            is IntArray -> w(o, v.toList())
            is LongArray -> w(o, v.toList())
            is DoubleArray -> w(o, v.toList())
            is BooleanArray -> w(o, v.toList())
            is Array<*> -> w(o, v.toList())
            is List<*> -> { o.append('['); v.forEachIndexed { k, x -> if (k > 0) o.append(','); w(o, x) }; o.append(']') }
            else -> o.append(v.toString())
        }
    }
}
"""


def kotlin_type(base, dims):
    if dims == 0:
        return KOTLIN_TYPES[base]
    if dims == 1 and base in KOTLIN_PRIMITIVE:
        return KOTLIN_PRIMITIVE[base][0]
    return f"Array<{kotlin_type(base, dims - 1)}>"


def kotlin_read(base, dims):
    if dims == 0:
        return KOTLIN_SCALAR[base]
    if dims == 1 and base in KOTLIN_PRIMITIVE:
        return f"__P.list {{ {KOTLIN_SCALAR[base]} }}.{KOTLIN_PRIMITIVE[base][1]}()"
    return f"__P.list {{ {kotlin_read(base, dims - 1)} }}.toTypedArray()"


def generate_kotlin(source, name, params, returns, marker):
    lines = ["fun main() {", "    __P.src = System.`in`.readBytes().toString(Charsets.UTF_8)"]
    for i, (base, dims) in enumerate(params):
        lines.append(f"    val __p{i}: {kotlin_type(base, dims)} = {kotlin_read(base, dims)}")
    args = ", ".join(f"__p{i}" for i in range(len(params)))
    lines += [f"    val __r: {kotlin_type(*returns)} = Solution().{name}({args})",
              "    val __o = StringBuilder(); __P.w(__o, __r)",
              f"    System.out.flush(); System.out.write((\"\\n\" + {marker} + \"\\n\" + __o + \"\\n\").toByteArray(Charsets.UTF_8)); System.out.flush()", "}"]
    return source + "\n" + KOTLIN_RUNTIME + "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------------------------
# C#: class Solution with jagged arrays (int[][]), like LeetCode.

CSHARP_TYPES = {"int": "int", "long": "long", "double": "double", "bool": "bool", "string": "string"}
CSHARP_SCALAR = {"int": "__P.I()", "long": "__P.L()", "double": "__P.D()", "bool": "__P.B()", "string": "__P.S()"}
CSHARP_RUNTIME = r"""
static class __P {
    public static string s = ""; public static int at;
    public static Exception Bad() { Console.Error.WriteLine("invalid test input"); Environment.Exit(3); return new Exception(); }
    static void Ws() { while (at < s.Length && char.IsWhiteSpace(s[at])) at++; }
    public static bool Peek(char c) { Ws(); return at < s.Length && s[at] == c; }
    public static void Expect(char c) { if (!Peek(c)) throw Bad(); at++; }
    static string Token() {
        Ws(); int start = at;
        while (at < s.Length && (char.IsLetterOrDigit(s[at]) || s[at] == '+' || s[at] == '-' || s[at] == '.')) at++;
        if (start == at) throw Bad();
        return s.Substring(start, at - start);
    }
    static readonly System.Globalization.CultureInfo C = System.Globalization.CultureInfo.InvariantCulture;
    public static int I() { int v; if (!int.TryParse(Token(), System.Globalization.NumberStyles.Integer, C, out v)) throw Bad(); return v; }
    public static long L() { long v; if (!long.TryParse(Token(), System.Globalization.NumberStyles.Integer, C, out v)) throw Bad(); return v; }
    public static double D() { double v; if (!double.TryParse(Token(), System.Globalization.NumberStyles.Float, C, out v)) throw Bad(); return v; }
    public static bool B() { string t = Token(); if (t == "true") return true; if (t == "false") return false; throw Bad(); }
    public static string S() {
        Expect('"'); var v = new System.Text.StringBuilder();
        while (true) {
            if (at >= s.Length) throw Bad();
            char c = s[at++];
            if (c == '"') return v.ToString();
            if (c != '\\') { v.Append(c); continue; }
            if (at >= s.Length) throw Bad();
            c = s[at++];
            switch (c) {
                case 'n': v.Append('\n'); break; case 't': v.Append('\t'); break; case 'r': v.Append('\r'); break;
                case 'b': v.Append('\b'); break; case 'f': v.Append('\f'); break;
                case 'u':
                    int u;
                    if (at + 4 > s.Length || !int.TryParse(s.Substring(at, 4), System.Globalization.NumberStyles.HexNumber, C, out u)) throw Bad();
                    v.Append((char)u); at += 4; break;
                default: v.Append(c); break;
            }
        }
    }
    public static System.Collections.Generic.List<T> List<T>(Func<T> item) {
        Expect('['); var v = new System.Collections.Generic.List<T>();
        if (Peek(']')) { at++; return v; }
        while (true) { v.Add(item()); if (Peek(',')) { at++; continue; } Expect(']'); return v; }
    }
    public static void W(System.Text.StringBuilder o, object v) {
        if (v == null) o.Append("null");
        else if (v is string) {
            o.Append('"');
            foreach (char c in (string)v) {
                if (c == '"' || c == '\\') o.Append('\\').Append(c);
                else if (c < 0x20) o.Append("\\u").Append(((int)c).ToString("x4"));
                else o.Append(c);
            }
            o.Append('"');
        }
        else if (v is bool) o.Append((bool)v ? "true" : "false");
        else if (v is double) o.Append(((double)v).ToString("R", C));
        else if (v is Array) { o.Append('['); int k = 0; foreach (object x in (Array)v) { if (k++ > 0) o.Append(','); W(o, x); } o.Append(']'); }
        else o.Append(Convert.ToString(v, C));
    }
}
"""


def csharp_type(base, dims):
    return CSHARP_TYPES[base] + "[]" * dims


def csharp_read(base, dims):
    if dims == 0:
        return CSHARP_SCALAR[base]
    return f"__P.List(() => {csharp_read(base, dims - 1)}).ToArray()"


def generate_csharp(source, name, params, returns, marker):
    lines = ["class __Main {", "    static void Main() {",
             "        using (var input = new System.IO.StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false))) __P.s = input.ReadToEnd();"]
    for i, (base, dims) in enumerate(params):
        lines.append(f"        {csharp_type(base, dims)} p{i} = {csharp_read(base, dims)};")
    args = ", ".join(f"p{i}" for i in range(len(params)))
    lines += [f"        {csharp_type(*returns)} r = new Solution().{name}({args});",
              "        var o = new System.Text.StringBuilder(); __P.W(o, r);",
              "        Console.Out.Flush();",
              f"        byte[] bytes = new System.Text.UTF8Encoding(false).GetBytes(\"\\n\" + {marker} + \"\\n\" + o + \"\\n\");",
              "        using (var stdout = Console.OpenStandardOutput()) { stdout.Write(bytes, 0, bytes.Length); stdout.Flush(); }",
              "    }", "}"]
    prefix = "using System;\nusing System.Collections.Generic;\nusing System.Linq;\nusing System.Text;\n#line 1\n"
    return prefix + source + "\n#line 100000 \"driver\"\n" + CSHARP_RUNTIME + "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------------------------
# Ruby: a snake_case method, like LeetCode.

RUBY_RUNTIME = r"""

__cp_params = PARAMS
__cp_returns = RETURNS
__cp_convert = lambda do |value, base, dims|
  dims > 0 ? value.map { |item| __cp_convert.call(item, base, dims - 1) } : (base == "double" ? value.to_f : value)
end
__cp_show = lambda do |value, base, dims|
  if dims > 0
    "[" + value.map { |item| __cp_show.call(item, base, dims - 1) }.join(",") + "]"
  elsif base == "int" || base == "long"
    Integer(value).to_s
  elsif base == "double"
    Float(value).to_s
  elsif base == "bool"
    value ? "true" : "false"
  else
    value.to_s.to_json
  end
end
__cp_lines = STDIN.binmode.read.force_encoding("UTF-8").split("\n").reject { |line| line.strip.empty? }
if __cp_lines.length < __cp_params.length
  STDERR.puts "invalid test input"
  exit 3
end
__cp_args = __cp_params.each_with_index.map { |(base, dims), i| __cp_convert.call(JSON.parse(__cp_lines[i]), base, dims) }
__cp_result = NAME(*__cp_args)
STDOUT.flush
STDOUT.write("\n" + MARKER + "\n" + __cp_show.call(__cp_result, *__cp_returns) + "\n")
"""


def generate_ruby(source, name, params, returns, marker):
    return "require 'json'\nrequire 'set'\n" + source + (
        RUBY_RUNTIME.replace("PARAMS", json.dumps(params)).replace("RETURNS", json.dumps(returns))
        .replace("MARKER", marker).replace("NAME", snake(name)))


# ---------------------------------------------------------------------------------------------
# PHP: class Solution, like LeetCode. The contestant's file starts with <?php.

PHP_RUNTIME = r"""
$__cp_params = PARAMS;
$__cp_returns = RETURNS;
$__cp_convert = function ($value, $base, $dims) use (&$__cp_convert) {
    if ($dims > 0) return array_map(fn($item) => $__cp_convert($item, $base, $dims - 1), $value);
    return $base === 'double' ? (float)$value : $value;
};
$__cp_show = function ($value, $base, $dims) use (&$__cp_show) {
    if ($dims > 0) return '[' . implode(',', array_map(fn($item) => $__cp_show($item, $base, $dims - 1), $value)) . ']';
    if ($base === 'int' || $base === 'long') return (string)intval($value);
    if ($base === 'double') return json_encode((float)$value, JSON_PRESERVE_ZERO_FRACTION);
    if ($base === 'bool') return $value ? 'true' : 'false';
    return json_encode((string)$value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
};
$__cp_lines = array_values(array_filter(explode("\n", stream_get_contents(STDIN)), fn($line) => trim($line) !== ''));
if (count($__cp_lines) < count($__cp_params)) { fwrite(STDERR, "invalid test input\n"); exit(3); }
$__cp_args = [];
foreach ($__cp_params as $__cp_i => [$__cp_base, $__cp_dims]) $__cp_args[] = $__cp_convert(json_decode($__cp_lines[$__cp_i], true), $__cp_base, $__cp_dims);
$__cp_result = (new Solution())->NAME(...$__cp_args);
echo "\n", MARKER, "\n", $__cp_show($__cp_result, ...$__cp_returns), "\n";
"""


def generate_php(source, name, params, returns, marker):
    # A file that closed PHP mode gets it reopened.
    tail = "\n<?php\n" if source.rstrip().endswith("?>") else "\n"
    return source + tail + (PHP_RUNTIME.replace("PARAMS", json.dumps(params)).replace("RETURNS", json.dumps(returns))
                            .replace("MARKER", marker).replace("NAME", name))


# ---------------------------------------------------------------------------------------------
# Zig (0.13): a top-level function that receives an allocator first and may return an error.

ZIG_TYPES = {"int": "i32", "long": "i64", "double": "f64", "bool": "bool", "string": "[]const u8"}
ZIG_RUNTIME = r"""
const __std = @import("std");
const __P = struct {
    s: []const u8,
    at: usize = 0,
    a: __std.mem.Allocator,
    fn bad() noreturn {
        __std.io.getStdErr().writer().writeAll("invalid test input\n") catch {};
        __std.process.exit(3);
    }
    fn ws(p: *__P) void {
        while (p.at < p.s.len and __std.ascii.isWhitespace(p.s[p.at])) p.at += 1;
    }
    fn peek(p: *__P, c: u8) bool {
        p.ws();
        return p.at < p.s.len and p.s[p.at] == c;
    }
    fn expect(p: *__P, c: u8) void {
        if (!p.peek(c)) bad();
        p.at += 1;
    }
    fn token(p: *__P) []const u8 {
        p.ws();
        const start = p.at;
        while (p.at < p.s.len and (__std.ascii.isAlphanumeric(p.s[p.at]) or p.s[p.at] == '-' or p.s[p.at] == '+' or p.s[p.at] == '.')) p.at += 1;
        if (start == p.at) bad();
        return p.s[start..p.at];
    }
    fn hex4(p: *__P) u21 {
        if (p.at + 4 > p.s.len) bad();
        const v = __std.fmt.parseInt(u21, p.s[p.at .. p.at + 4], 16) catch bad();
        p.at += 4;
        return v;
    }
    fn string(p: *__P) []u8 {
        p.expect('"');
        var v = __std.ArrayList(u8).init(p.a);
        while (true) {
            if (p.at >= p.s.len) bad();
            const c = p.s[p.at];
            p.at += 1;
            if (c == '"') return v.toOwnedSlice() catch bad();
            if (c != '\\') {
                v.append(c) catch bad();
                continue;
            }
            if (p.at >= p.s.len) bad();
            const e = p.s[p.at];
            p.at += 1;
            switch (e) {
                'n' => v.append('\n') catch bad(),
                't' => v.append('\t') catch bad(),
                'r' => v.append('\r') catch bad(),
                'b' => v.append(8) catch bad(),
                'f' => v.append(12) catch bad(),
                'u' => {
                    var u = p.hex4();
                    if (u >= 0xD800 and u < 0xDC00 and p.at + 1 < p.s.len and p.s[p.at] == '\\' and p.s[p.at + 1] == 'u') {
                        p.at += 2;
                        const low = p.hex4();
                        if (low < 0xDC00 or low > 0xDFFF) bad();
                        u = 0x10000 + ((u - 0xD800) << 10) + (low - 0xDC00);
                    }
                    var buffer: [4]u8 = undefined;
                    const n = __std.unicode.utf8Encode(u, &buffer) catch bad();
                    v.appendSlice(buffer[0..n]) catch bad();
                },
                else => v.append(e) catch bad(),
            }
        }
    }
    fn read(p: *__P, comptime T: type) T {
        switch (@typeInfo(T)) {
            .Int => return __std.fmt.parseInt(T, p.token(), 10) catch bad(),
            .Float => return __std.fmt.parseFloat(T, p.token()) catch bad(),
            .Bool => {
                const t = p.token();
                if (__std.mem.eql(u8, t, "true")) return true;
                if (__std.mem.eql(u8, t, "false")) return false;
                bad();
            },
            .Pointer => |info| {
                if (info.child == u8) {
                    return p.string();
                } else {
                    p.expect('[');
                    var list = __std.ArrayList(info.child).init(p.a);
                    if (p.peek(']')) {
                        p.at += 1;
                        return list.toOwnedSlice() catch bad();
                    }
                    while (true) {
                        list.append(p.read(info.child)) catch bad();
                        if (p.peek(',')) {
                            p.at += 1;
                            continue;
                        }
                        p.expect(']');
                        return list.toOwnedSlice() catch bad();
                    }
                }
            },
            else => @compileError("unsupported type"),
        }
    }
    fn write(o: *__std.ArrayList(u8), v: anytype) void {
        const T = @TypeOf(v);
        switch (@typeInfo(T)) {
            .Int, .ComptimeInt => o.writer().print("{d}", .{v}) catch bad(),
            .Float, .ComptimeFloat => o.writer().print("{e}", .{v}) catch bad(),
            .Bool => o.appendSlice(if (v) "true" else "false") catch bad(),
            .Pointer => |info| {
                if (info.child == u8) {
                    o.append('"') catch bad();
                    for (v) |c| {
                        if (c == '"' or c == '\\') {
                            o.append('\\') catch bad();
                            o.append(c) catch bad();
                        } else if (c < 0x20) {
                            o.writer().print("\\u{x:0>4}", .{c}) catch bad();
                        } else o.append(c) catch bad();
                    }
                    o.append('"') catch bad();
                } else {
                    o.append('[') catch bad();
                    for (v, 0..) |item, i| {
                        if (i > 0) o.append(',') catch bad();
                        write(o, item);
                    }
                    o.append(']') catch bad();
                }
            },
            else => @compileError("unsupported type"),
        }
    }
};
"""


def zig_type(base, dims):
    return "[]" * dims + ZIG_TYPES[base]


def generate_zig(source, name, params, returns, marker):
    lines = ["pub fn main() !void {",
             "    var __arena = __std.heap.ArenaAllocator.init(__std.heap.page_allocator);",
             "    const __a = __arena.allocator();",
             "    const __input = try __std.io.getStdIn().readToEndAlloc(__a, 1 << 30);",
             "    var __p = __P{ .s = __input, .a = __a };"]
    for i, (base, dims) in enumerate(params):
        lines.append(f"    const __p{i} = __p.read({zig_type(base, dims)});")
    args = ", ".join(["__a"] + [f"__p{i}" for i in range(len(params))])
    lines += [f"    const __call = {name}({args});",
              # The function may return an error union or a plain value.
              f"    const __r: {zig_type(*returns)} = if (@typeInfo(@TypeOf(__call)) == .ErrorUnion) try __call else __call;",
              "    var __o = __std.ArrayList(u8).init(__a);",
              "    __P.write(&__o, __r);",
              f"    try __std.io.getStdOut().writer().print(\"\\n{{s}}\\n{{s}}\\n\", .{{ {marker}, __o.items }});", "}"]
    return source + "\n" + ZIG_RUNTIME + "\n".join(lines) + "\n"


GENERATORS = {"CPP": generate_cpp, "C": generate_c, "JAVA": generate_java, "PYTHON": generate_python,
              "JAVASCRIPT": generate_javascript, "GO": generate_go, "RUST": generate_rust, "KOTLIN": generate_kotlin,
              "CSHARP": generate_csharp, "RUBY": generate_ruby, "PHP": generate_php, "ZIG": generate_zig}
