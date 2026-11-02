import json
import os
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import drivers
from drivers import BASES, FUNCTION_LANGUAGES, parse_type, result_matches, same, snake, validate, wrap

TWO_SUM = {"functionName": "twoSum", "params": [{"name": "nums", "type": "int[]"}, {"name": "target", "type": "int"}], "returnType": "int[]"}
MARKER = "@@cp-result-test"


def identity_signature(type_):
    return {"functionName": "same", "params": [{"name": "x", "type": type_}], "returnType": type_}


def identity_source(language, base, dims):
    """A solution returning its argument, written the way the starter code asks for it."""
    if language in ("CPP", "CPP20"):
        t = drivers.cpp_type(base, dims)
        return f"class Solution {{\npublic:\n    {t} same({t + '&' if dims else t} x) {{\n        return x;\n    }}\n}};\n"
    if language == "C":
        t = drivers.C_TYPES[base] + "*" * dims
        if dims == 0:
            return f"{t} same({t} x) {{\n    return x;\n}}\n"
        if dims == 1:
            return f"{t} same({t} x, int xSize, int* returnSize) {{\n    *returnSize = xSize;\n    return x;\n}}\n"
        return (f"{t} same({t} x, int xSize, int* xColSize, int* returnSize, int** returnColumnSizes) {{\n"
                "    *returnSize = xSize;\n    *returnColumnSizes = xColSize;\n    return x;\n}\n")
    if language == "JAVA":
        t = drivers.java_type(base, dims)
        return f"class Solution {{\n    public {t} same({t} x) {{\n        return x;\n    }}\n}}\n"
    if language in ("PYTHON", "PYPY"):
        return "class Solution:\n    def same(self, x):\n        return x\n"
    if language == "JAVASCRIPT":
        return "function same(x) {\n    return x;\n}\n"
    if language == "GO":
        t = drivers.go_type(base, dims)
        return f"func same(x {t}) {t} {{\n    return x\n}}\n"
    if language == "RUST":
        t = drivers.rust_type(base, dims)
        return f"impl Solution {{\n    pub fn same(x: {t}) -> {t} {{\n        x\n    }}\n}}\n"
    if language == "KOTLIN":
        t = drivers.kotlin_type(base, dims)
        return f"class Solution {{\n    fun same(x: {t}): {t} {{\n        return x\n    }}\n}}\n"
    if language == "CSHARP":
        t = drivers.csharp_type(base, dims)
        return f"public class Solution {{\n    public {t} same({t} x) {{\n        return x;\n    }}\n}}\n"
    if language == "RUBY":
        return "def same(x)\n    x\nend\n"
    if language == "PHP":
        return "<?php\n\nclass Solution {\n    function same($x) {\n        return $x;\n    }\n}\n"
    if language == "ZIG":
        t = drivers.zig_type(base, dims)
        return f"const std = @import(\"std\");\n\npub fn same(allocator: std.mem.Allocator, x: {t}) !{t} {{\n    _ = allocator;\n    return x;\n}}\n"
    raise ValueError(language)


SCALARS = {"int": [7, -2147483648], "long": [1234567890123, -5], "double": [2.5, -0.125],
           "bool": [True, False], "string": ["a\"b\\cé \U0001F600\n", ""]}


def sample(base, dims, which=0):
    if dims == 0:
        return SCALARS[base][which]
    return [sample(base, dims - 1, 0), sample(base, dims - 1, 1)] if dims == 1 else [sample(base, 1), [], sample(base, 1)]


class SignatureTests(unittest.TestCase):
    def test_types_and_names(self):
        self.assertEqual(parse_type("int[][]"), ("int", 2))
        self.assertEqual(parse_type("string"), ("string", 0))
        for bad in ("int[][][]", "float", "int[", "[]"):
            with self.assertRaises(ValueError):
                parse_type(bad)
        self.assertEqual(snake("twoSum"), "two_sum")
        self.assertEqual(snake("maxAreaOfIsland2D"), "max_area_of_island2_d")
        with self.assertRaises(ValueError):
            validate({**TWO_SUM, "functionName": "Two"})
        with self.assertRaises(ValueError):
            validate({**TWO_SUM, "params": [{"name": "nums", "type": "int"}, {"name": "nums", "type": "int"}]})
        self.assertEqual(validate(TWO_SUM), ("twoSum", [("int", 1), ("int", 0)], ("int", 1)))


class ComparisonTests(unittest.TestCase):
    def check(self, printed, expected, signature=TWO_SUM):
        return result_matches(printed.encode(), expected, signature, MARKER)

    def test_value_after_the_last_marker_is_compared(self):
        self.assertTrue(self.check(f"debug\n{MARKER}\n[0,1]\n", "[0, 1]"))
        self.assertTrue(self.check(f"{MARKER}\n[9]\n\n{MARKER}\n[ 0 , 1 ]", "[0,1]"))
        self.assertFalse(self.check("[0,1]\n", "[0,1]"))
        self.assertFalse(self.check(f"\n{MARKER}\n[1,0]\n", "[0,1]"))
        self.assertFalse(self.check(f"\n{MARKER}\nnot json\n", "[0,1]"))
        self.assertFalse(result_matches(b"\n" + MARKER.encode() + b"\n\xff", "[0,1]", TWO_SUM, MARKER))

    def test_types_are_strict_and_doubles_tolerant(self):
        self.assertFalse(same(1, 1.0, "int", 0))
        self.assertFalse(same(1, True, "int", 0))
        self.assertFalse(same(True, 1, "bool", 0))
        self.assertTrue(same(0.1, 0.1000001, "double", 0))
        self.assertTrue(same(1e9, 1e9 + 1, "double", 0))
        self.assertTrue(same(2, 2, "double", 0))
        self.assertFalse(same(0.1, 0.11, "double", 0))
        self.assertFalse(same(1.0, float("nan"), "double", 0))
        self.assertTrue(same([["a"], []], [["a"], []], "string", 2))
        self.assertFalse(same([[1]], [[1], []], "int", 2))


class WrapTests(unittest.TestCase):
    def test_every_function_language_wraps_the_contestant_code(self):
        for language in FUNCTION_LANGUAGES:
            for base in BASES:
                code = wrap(language, identity_source(language, base, 1), identity_signature(base + "[]"), MARKER)
                self.assertIn("same", code)
                self.assertIn(json.dumps(MARKER), code)

    def test_brainfuck_has_no_functions(self):
        with self.assertRaises(ValueError):
            wrap("BRAINFUCK", ",[.,]", TWO_SUM, MARKER)

    def test_compiler_line_numbers_stay_the_contestants(self):
        # The C-family drivers reset line numbers; Java and Go put their header on line 1.
        for language in ("CPP", "C", "CSHARP"):
            code = wrap(language, "LINE_ONE", TWO_SUM, MARKER)
            self.assertIn("#line 1\nLINE_ONE", code)
        for language in ("JAVA", "GO"):
            self.assertEqual(wrap(language, "LINE_ONE\n", TWO_SUM, MARKER).split("\n")[0].endswith("LINE_ONE"), True)

    def test_placeholder_words_in_names_are_safe(self):
        # The name is filled in last, so a name containing MARKER or PARAMS cannot be rewritten.
        for name in ("getMARKER", "readPARAMS"):
            signature = {"functionName": name, "params": [{"name": "x", "type": "int"}], "returnType": "int"}
            for language in ("PYTHON", "JAVASCRIPT", "PHP"):
                code = wrap(language, "", signature, MARKER)
                self.assertIn(name + "(", code)
                self.assertIn(json.dumps(MARKER), code)


@unittest.skipUnless(os.getenv("CP_DOCKER_TESTS") == "1", "Requires opt-in Linux Docker/cgroup-v2 judge host")
class DockerFunctionTests(unittest.TestCase):
    """Every function language, every type, through the real sandbox."""
    @classmethod
    def setUpClass(cls):
        from runner import DockerRunner, IMAGE_NAMES
        cls.runner = DockerRunner(os.getenv("JUDGE_WORK_ROOT", "/judge/work"), os.environ["JUDGE_HOST_WORK_ROOT"], {}, 1024)
        wanted = os.getenv("JUDGE_LANGUAGES", ",".join(sorted(FUNCTION_LANGUAGES))).split(",")
        cls.languages = [l for l in sorted(FUNCTION_LANGUAGES) if l in wanted]
        for language in cls.languages:
            cls.runner.verify_runtime(language, os.getenv("JUDGE_IMAGE_" + language, "cp-judge-" + IMAGE_NAMES.get(language, language.lower()) + ":local"))

    def judge(self, language, source, signature, tests):
        return self.runner.judge({"language_code": language, "source_code": source, "time_limit_ms": 5000, "memory_limit_mb": 256,
                                  "output_limit_kb": 64, "checker": "EXACT", "run_all_tests": True, "function_signature": json.dumps(signature),
                                  "tests": [{"id": str(i), "input_data": a, "expected_output": b} for i, (a, b) in enumerate(tests)]})

    def test_every_type_round_trips(self):
        for language in self.languages:
            for base in BASES:
                for dims in range(3):
                    with self.subTest(language=language, type=base + "[]" * dims):
                        value = sample(base, dims)
                        result = self.judge(language, identity_source(language, base, dims), identity_signature(base + "[]" * dims),
                                            [(json.dumps(value) + "\n", json.dumps(value))])
                        self.assertEqual(result["verdict"], "ACCEPTED", result.get("compilerOutput"))

    def test_debug_output_is_ignored_and_wrong_answers_caught(self):
        python = "class Solution:\n    def twoSum(self, nums, target):\n        print('[9,9]')\n        return [0, 1]\n"
        result = self.judge("PYTHON", python, TWO_SUM, [("[2,7,11,15]\n9\n", "[0,1]"), ("[3,2,4]\n6\n", "[1,2]")])
        self.assertEqual([c["verdict"] for c in result["cases"]], ["ACCEPTED", "WRONG_ANSWER"])

    def test_compile_errors_point_at_the_contestants_lines(self):
        result = self.judge("CPP", "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        return oops;\n    }\n};\n",
                            TWO_SUM, [("[1]\n1\n", "[]")])
        self.assertEqual(result["verdict"], "COMPILATION_ERROR")
        self.assertIn("main.cpp:4:", result["compilerOutput"])
